//! Everything the window asks for, without Tauri, so it can be tested.
use crate::{
    catalog::{self, Catalog, Inspected},
    processes,
};
use parking_lot::{Mutex, RwLock};
use rbl_backup::{
    restore::{Parts, Phase},
    summary::Summary,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

/// Names a directory for this app's settings and caches instead of the
/// platform's, so a test run leaves nothing behind.
pub const DATA_DIR_ENV: &str = "RBXPORT_RESTORE_DIR";

const WEEK_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// An error as the window shows it.
#[derive(Debug, Serialize)]
pub struct Failure {
    pub message: String,
}

impl Failure {
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl From<rbl_backup::Error> for Failure {
    fn from(error: rbl_backup::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

pub type Outcome<T> = Result<T, Failure>;

/// Whether a restore can run, and what is in its way.
#[allow(clippy::struct_excessive_bools, reason = "independent facts the window shows side by side")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The installed library's `master.db`.
    pub library: Option<String>,
    pub library_error: Option<String>,
    pub rekordbox_running: bool,
    pub rbxport_running: bool,
    pub analysis_edit_pending: bool,
    /// A restore was interrupted and has not been finished or rolled back.
    pub restore_pending: bool,
}

/// One backup, as the list shows it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub name: String,
    /// The ZIP's size on disk.
    pub bytes: u64,
    pub created_at: u64,
    pub includes_artwork: bool,
    pub library_files: Vec<String>,
    /// The `master.db` the backup was taken from.
    pub library: String,
    pub belongs_to_library: bool,
    pub summary: Option<Summary>,
    pub summary_computed: bool,
}

/// The folder whose backups are listed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub path: String,
    /// Chosen here, rather than RBXport's Default backup folder.
    pub chosen: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProgress {
    pub running: bool,
    /// preparing, unpacking, validating, replacing, stopping; then
    /// complete, cancelled or failed.
    pub phase: String,
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub current_item: Option<String>,
    pub error: Option<String>,
    pub path: Option<String>,
    pub parts: Option<Parts>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    /// A folder chosen here; RBXport's Default backup folder otherwise.
    backup_folder: Option<PathBuf>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedLibrary {
    master_db: PathBuf,
    summary: Summary,
}

pub struct AppState {
    /// RBXport's backup state: its folder setting and the restore journal.
    state_dir: PathBuf,
    data_dir: PathBuf,
    cache_dir: PathBuf,
    folder: RwLock<Option<PathBuf>>,
    restore: Mutex<RestoreProgress>,
    catalog: Mutex<Catalog>,
    library: Mutex<Option<Summary>>,
    /// Working out a summary uses every core; one at a time.
    summarizing: Mutex<()>,
    /// Which of rekordbox and RBXport are running; replaced in tests.
    processes: fn() -> processes::Running,
}

fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Preparing => "preparing",
        Phase::Unpacking => "unpacking",
        Phase::Validating => "validating",
        Phase::Replacing => "replacing",
    }
}

fn is_zip(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

impl AppState {
    pub fn new(state_dir: PathBuf, data_dir: PathBuf, cache_dir: PathBuf) -> Self {
        let settings: Settings = std::fs::read(data_dir.join("settings.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            catalog: Mutex::new(Catalog::load(cache_dir.join("catalog.json"))),
            state_dir,
            data_dir,
            cache_dir,
            folder: RwLock::new(settings.backup_folder),
            restore: Mutex::new(RestoreProgress::default()),
            library: Mutex::new(None),
            summarizing: Mutex::new(()),
            processes: processes::running,
        }
    }

    pub fn status(&self) -> Status {
        let running = (self.processes)();
        let (library, library_error) = match rbl_db::detect() {
            Ok(location) => (Some(location.master_db.to_string_lossy().into_owned()), None),
            Err(error) => (None, Some(format!("rekordbox's library could not be found: {error}"))),
        };
        Status {
            library,
            library_error,
            rekordbox_running: running.rekordbox,
            rbxport_running: running.rbxport,
            analysis_edit_pending: rbl_backup::analysis_edit_pending(&self.state_dir),
            restore_pending: rbl_backup::journal::pending(&self.state_dir),
        }
    }

    /// Finishes or rolls back an interrupted restore.
    pub fn recover(&self) -> Outcome<()> {
        if !rbl_backup::journal::pending(&self.state_dir) {
            return Ok(());
        }
        let location = rbl_db::detect().map_err(|e| Failure::new(e.to_string()))?;
        rbl_backup::journal::recover(&self.state_dir, &location)?;
        self.forget_library();
        Ok(())
    }

    /// The folder whose backups are listed.
    pub fn folder(&self) -> PathBuf {
        self.folder.read().clone().unwrap_or_else(|| rbl_backup::default_destination(&self.state_dir))
    }

    pub fn folder_shown(&self) -> Folder {
        Folder { path: self.folder().to_string_lossy().into_owned(), chosen: self.folder.read().is_some() }
    }

    /// Lists another folder's backups, or RBXport's own again with `None`.
    pub fn set_folder(&self, folder: Option<&Path>) -> Outcome<Folder> {
        let folder = match folder {
            Some(folder) => {
                let folder = folder.canonicalize().map_err(|e| Failure::new(format!("The folder could not be opened: {e}")))?;
                if !folder.is_dir() {
                    return Err(Failure::new("Choose a folder."));
                }
                Some(folder)
            }
            None => None,
        };
        let settings = Settings { backup_folder: folder.clone() };
        rbl_core::durable::create_dir_all(&self.data_dir)?;
        rbl_core::durable::write(
            &self.data_dir.join("settings.json"),
            &serde_json::to_vec(&settings).map_err(|e| Failure::new(e.to_string()))?,
        )?;
        *self.folder.write() = folder;
        Ok(self.folder_shown())
    }

    fn entry(path: &Path, inspected: Inspected, location: Option<&rbl_db::LibraryLocation>) -> BackupEntry {
        BackupEntry {
            path: path.to_string_lossy().into_owned(),
            name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            bytes: std::fs::metadata(path).map_or(0, |meta| meta.len()),
            created_at: inspected.manifest.created_at,
            includes_artwork: inspected.manifest.includes_artwork,
            library_files: inspected.manifest.library_files.clone(),
            library: inspected.manifest.library.to_string_lossy().into_owned(),
            belongs_to_library: location.is_some_and(|location| inspected.manifest.belongs_to(location)),
            summary: inspected.summary,
            summary_computed: inspected.computed,
        }
    }

    fn inspected(&self, path: &Path) -> Outcome<Inspected> {
        if let Some(known) = self.catalog.lock().get(path) {
            return Ok(known);
        }
        let inspected = catalog::inspect(path)?;
        self.catalog.lock().insert(path, inspected.clone());
        Ok(inspected)
    }

    /// Every RBXport backup in the folder, newest first. Other files and
    /// unreadable archives are left out.
    pub fn list(&self) -> Outcome<Vec<BackupEntry>> {
        let folder = self.folder();
        let entries = match std::fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(Failure::new(format!("The backup folder could not be read: {e}"))),
        };
        let paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| is_zip(path) && std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()))
            .collect();
        // Each archive is its own file, so several can be opened at once.
        let next = std::sync::atomic::AtomicUsize::new(0);
        let found = Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for _ in 0..paths.len().min(4) {
                scope.spawn(|| {
                    while let Some(path) = paths.get(next.fetch_add(1, std::sync::atomic::Ordering::Relaxed)) {
                        if let Ok(inspected) = self.inspected(path) {
                            found.lock().push((path.clone(), inspected));
                        }
                    }
                });
            }
        });
        self.catalog.lock().save();
        let location = rbl_db::detect().ok();
        let mut list: Vec<BackupEntry> = found
            .into_inner()
            .into_iter()
            .map(|(path, inspected)| Self::entry(&path, inspected, location.as_ref()))
            .collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.name.cmp(&a.name)));
        Ok(list)
    }

    /// A backup chosen from anywhere.
    pub fn inspect(&self, path: &Path) -> Outcome<BackupEntry> {
        let path = path.canonicalize().map_err(|e| Failure::new(format!("The file could not be opened: {e}")))?;
        if !is_zip(&path) {
            return Err(Failure::new("Choose an RBXport backup ZIP file."));
        }
        let inspected = self.inspected(&path)?;
        self.catalog.lock().save();
        Ok(Self::entry(&path, inspected, rbl_db::detect().ok().as_ref()))
    }

    /// The backup's summary: the one RBXport saved in it, or, for a backup
    /// made before summaries, one worked out by reading it.
    pub fn summary(&self, path: &Path) -> Outcome<Summary> {
        let inspected = self.inspected(path)?;
        if let Some(summary) = inspected.summary {
            return Ok(summary);
        }
        let _one = self.summarizing.lock();
        if let Some(summary) = self.catalog.lock().get(path).and_then(|known| known.summary) {
            return Ok(summary);
        }
        let location = rbl_db::detect().map_err(|e| Failure::new(format!("rekordbox's library could not be found, which reading this backup needs: {e}")))?;
        let started = Instant::now();
        let summary = rbl_backup::summary::from_archive(path, &location.passphrase, &self.cache_dir.join("scratch"))?;
        tracing::info!(path = %path.display(), elapsed = ?started.elapsed(), "worked out an older backup's summary");
        let mut catalog = self.catalog.lock();
        catalog.insert(path, Inspected { summary: Some(summary.clone()), computed: true, ..inspected });
        catalog.save();
        Ok(summary)
    }

    /// The library as it is now, measured at most weekly unless `refresh`.
    pub fn library_summary(&self, refresh: bool) -> Outcome<Summary> {
        let location = rbl_db::detect().map_err(|e| Failure::new(format!("rekordbox's library could not be found: {e}")))?;
        let file = self.cache_dir.join("library-summary.json");
        let mut cached = self.library.lock();
        if cached.is_none() {
            *cached = std::fs::read(&file)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<SavedLibrary>(&bytes).ok())
                .filter(|saved| saved.master_db == location.master_db)
                .map(|saved| saved.summary);
        }
        let now = rbl_core::time::unix_millis();
        if let Some(summary) = cached.as_ref().filter(|summary| !refresh && now.saturating_sub(summary.created_at) < WEEK_MS) {
            return Ok(summary.clone());
        }
        let summary = rbl_backup::summary::of_library(&location)?;
        let saved = SavedLibrary { master_db: location.master_db.clone(), summary: summary.clone() };
        let persist = || -> Result<(), Box<dyn std::error::Error>> {
            rbl_core::durable::create_dir_all(&self.cache_dir)?;
            rbl_core::durable::write(&file, &serde_json::to_vec(&saved)?)?;
            Ok(())
        };
        if let Err(error) = persist() {
            tracing::warn!(%error, "could not save the library summary");
        }
        *cached = Some(summary.clone());
        Ok(summary)
    }

    fn forget_library(&self) {
        *self.library.lock() = None;
        let _ = std::fs::remove_file(self.cache_dir.join("library-summary.json"));
    }

    /// Deletes a backup listed in the current folder.
    pub fn delete(&self, path: &Path) -> Outcome<()> {
        let folder = self.folder().canonicalize().map_err(|e| Failure::new(e.to_string()))?;
        let meta = std::fs::symlink_metadata(path)?;
        let path = path.canonicalize()?;
        if !meta.is_file() || !is_zip(&path) || path.parent() != Some(folder.as_path()) {
            return Err(Failure::new("Only backups in the backup folder can be deleted here."));
        }
        catalog::inspect(&path)?;
        std::fs::remove_file(&path)?;
        rbl_core::durable::sync_dir(&folder)?;
        let mut catalog = self.catalog.lock();
        catalog.forget(&path);
        catalog.save();
        Ok(())
    }

    pub fn restore_progress(&self) -> RestoreProgress {
        self.restore.lock().clone()
    }

    pub fn cancel_restore(&self) {
        let mut progress = self.restore.lock();
        // Once files are being replaced it runs to the end.
        if progress.running && progress.phase != "replacing" {
            progress.phase = "stopping".into();
        }
    }

    /// Starts restoring `parts` of the backup at `path`. The job is reserved
    /// before it starts, so two requests cannot both run.
    pub fn start_restore(self: &Arc<Self>, path: &Path, parts: Parts) -> Outcome<()> {
        {
            let mut progress = self.restore.lock();
            if progress.running {
                return Err(Failure::new("A restore is already running."));
            }
            *progress = RestoreProgress {
                running: true,
                phase: "preparing".into(),
                path: Some(path.to_string_lossy().into_owned()),
                parts: Some(parts),
                ..RestoreProgress::default()
            };
        }
        let state = Arc::clone(self);
        let path = path.to_path_buf();
        std::thread::Builder::new()
            .name("restore".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| state.run_restore(&path, parts)))
                    .unwrap_or_else(|_| Err(Failure::new("The restore stopped unexpectedly.")));
                state.forget_library();
                let mut progress = state.restore.lock();
                progress.running = false;
                progress.current_item = None;
                match result {
                    Ok(()) => progress.phase = "complete".into(),
                    Err(error) if error.message == rbl_backup::Error::Cancelled.to_string() => progress.phase = "cancelled".into(),
                    Err(error) => {
                        tracing::warn!(error = %error.message, "restore failed");
                        progress.phase = "failed".into();
                        progress.error = Some(error.message);
                    }
                }
            })
            .map_err(|e| {
                *self.restore.lock() = RestoreProgress::default();
                Failure::new(format!("The restore could not start: {e}"))
            })?;
        Ok(())
    }

    fn run_restore(&self, path: &Path, parts: Parts) -> Outcome<()> {
        let location = rbl_db::detect().map_err(|e| Failure::new(format!("rekordbox's library could not be found: {e}")))?;
        let sizes = self.catalog.lock().get(path).and_then(|known| known.summary).map(|summary| summary.sizes);
        let mut shown = Instant::now();
        rbl_backup::restore::restore(
            &rbl_backup::restore::Request { archive: path, parts, location: &location, state_dir: &self.state_dir, sizes: sizes.as_ref() },
            &|| {
                if (self.processes)().rbxport {
                    return Err(rbl_backup::Error::Refused("Quit RBXport before restoring a backup.".into()));
                }
                Ok(())
            },
            &mut |phase, done, total, item| {
                let mut progress = self.restore.lock();
                if progress.phase == "stopping" {
                    return Err(rbl_backup::Error::Cancelled);
                }
                let name = phase_name(phase);
                // The item changes thousands of times a second; show it at
                // most once a second, and at once when the phase changes.
                if progress.phase != name || progress.current_item.is_none() || shown.elapsed() >= Duration::from_secs(1) {
                    progress.current_item = Some(item.to_owned());
                    shown = Instant::now();
                }
                name.clone_into(&mut progress.phase);
                progress.done_bytes = done;
                progress.total_bytes = total;
                Ok(())
            },
        )?;
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_chosen_folder_is_remembered_and_can_go_back_to_rbxports() {
        let dir = tempfile::tempdir().unwrap();
        let state_dir = dir.path().join("rbxport");
        std::fs::create_dir_all(&state_dir).unwrap();
        let rbxport_folder = dir.path().join("rbxport folder");
        std::fs::create_dir_all(&rbxport_folder).unwrap();
        std::fs::write(state_dir.join(rbl_backup::DESTINATION_FILE), serde_json::to_vec(&rbxport_folder).unwrap()).unwrap();
        let state = AppState::new(state_dir.clone(), dir.path().join("data"), dir.path().join("cache"));
        assert_eq!(state.folder(), rbxport_folder);
        let chosen = dir.path().join("elsewhere");
        std::fs::create_dir_all(&chosen).unwrap();
        assert!(state.set_folder(Some(&chosen)).unwrap().chosen);
        let restarted = AppState::new(state_dir.clone(), dir.path().join("data"), dir.path().join("cache"));
        assert_eq!(restarted.folder(), chosen.canonicalize().unwrap());
        assert!(!restarted.set_folder(None).unwrap().chosen);
        assert_eq!(AppState::new(state_dir, dir.path().join("data"), dir.path().join("cache")).folder(), rbxport_folder);
        assert!(restarted.set_folder(Some(&dir.path().join("missing"))).is_err());
    }

    #[test]
    fn lists_only_readable_backups_newest_first_and_deletes_only_in_the_folder() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("backups");
        std::fs::create_dir_all(&folder).unwrap();
        let write = |name: &str, created_at: u64| {
            let path = folder.join(name);
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            zip.start_file("manifest.json", zip::write::SimpleFileOptions::default()).unwrap();
            let manifest = format!(r#"{{"version":2,"library":"/l/master.db","created_at":{created_at},"bytes":9}}"#);
            zip.write_all(manifest.as_bytes()).unwrap();
            zip.finish().unwrap();
            path
        };
        write("older.zip", 1);
        let newer = write("newer.ZIP", 2);
        std::fs::write(folder.join("notes.zip"), b"not a zip").unwrap();
        std::fs::write(folder.join("notes.txt"), b"text").unwrap();
        let state = AppState::new(dir.path().join("rbxport"), dir.path().join("data"), dir.path().join("cache"));
        state.set_folder(Some(&folder)).unwrap();
        let listed = state.list().unwrap();
        assert_eq!(listed.iter().map(|entry| entry.name.as_str()).collect::<Vec<_>>(), ["newer.ZIP", "older.zip"]);
        assert!(listed.iter().all(|entry| entry.summary.is_none() && !entry.belongs_to_library));
        let outside = dir.path().join("outside.zip");
        std::fs::copy(&newer, &outside).unwrap();
        assert!(state.delete(&outside).is_err());
        assert!(state.delete(&folder.join("notes.zip")).is_err());
        state.delete(&newer).unwrap();
        assert_eq!(state.list().unwrap().len(), 1);
        assert!(outside.exists());
    }

    /// The window's whole path on a real archive: list it, read an older
    /// backup's summary, restore one part and see only that part change.
    #[test]
    fn lists_summarizes_and_restores_one_part_of_a_backup() {
        use rbl_backup::testing;
        static RBXPORT_OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if processes::running().rekordbox {
            eprintln!("skipped: rekordbox is running, and a restore is refused while it is");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let location = testing::library(&dir.path().join("library"));
        let options = dir.path().join("options.json");
        rbl_db::fixture::write_options_json(&options, &location.master_db.to_string_lossy(), &location.passphrase).unwrap();
        // Only this test detects a library, so setting it process-wide is safe.
        std::env::set_var(rbl_db::OPTIONS_ENV, &options);
        testing::set_rating(&location, 4);
        let grid = rbl_backup::analysis_dir(&location).join("P001/0001/ANLZ0000.DAT");
        std::fs::create_dir_all(grid.parent().unwrap()).unwrap();
        std::fs::write(&grid, testing::anlz(&[b"PQTZ", b"PCOB"])).unwrap();
        let state_dir = dir.path().join("rbxport");
        std::fs::create_dir_all(&state_dir).unwrap();
        let saved = state_dir.join("rbexport-20260924-1000.zip");
        testing::archive(&location, &saved, Some(&rbl_backup::summary::of_library(&location).unwrap()));
        let older = state_dir.join("library-older.zip");
        testing::archive(&location, &older, None);
        testing::set_rating(&location, 1);
        std::fs::write(&grid, b"edited").unwrap();

        let mut state = AppState::new(state_dir, dir.path().join("data"), dir.path().join("cache"));
        state.processes = || processes::Running { rekordbox: false, rbxport: RBXPORT_OPEN.load(std::sync::atomic::Ordering::Relaxed) };
        let state = Arc::new(state);
        let listed = state.list().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|entry| entry.belongs_to_library));
        let with_summary = listed.iter().find(|entry| entry.name.starts_with("rbexport-")).unwrap();
        let tracks = with_summary.summary.as_ref().unwrap().counts.tracks;
        assert!(listed.iter().any(|entry| entry.name.starts_with("library-") && entry.summary.is_none()));
        let worked_out = state.summary(&older).unwrap();
        assert_eq!(worked_out.counts.tracks, tracks);
        assert_eq!(worked_out.sizes.beat_grids, 16);
        let relisted = state.list().unwrap();
        let older_entry = relisted.iter().find(|entry| entry.name.starts_with("library-")).unwrap();
        assert!(older_entry.summary_computed && older_entry.summary.is_some());

        let finish = || {
            let deadline = Instant::now() + Duration::from_secs(30);
            while state.restore_progress().running {
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(20));
            }
            state.restore_progress()
        };
        RBXPORT_OPEN.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(state.status().rbxport_running);
        state.start_restore(&saved, Parts::ALL).unwrap();
        let refused = finish();
        assert_eq!((refused.phase.as_str(), refused.error.as_deref()), ("failed", Some("Quit RBXport before restoring a backup.")));
        assert_eq!(testing::rating(&location), 1);
        RBXPORT_OPEN.store(false, std::sync::atomic::Ordering::Relaxed);

        state.start_restore(&saved, Parts { database: true, ..Parts::default() }).unwrap();
        assert!(state.start_restore(&saved, Parts::ALL).is_err(), "one restore at a time");
        let progress = finish();
        assert_eq!(progress.phase, "complete", "{:?}", progress.error);
        assert_eq!(testing::rating(&location), 4);
        assert_eq!(std::fs::read(&grid).unwrap(), b"edited", "analysis was not chosen");
        assert_eq!(state.library_summary(false).unwrap().counts.tracks, tracks);
    }
}
