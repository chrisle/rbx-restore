//! What each backup holds, remembered by file. Opening a large archive reads
//! its whole central directory (half a second for one of 280,000 entries),
//! and a summary worked out from an older backup takes seconds, so neither
//! is repeated for a file that has not changed.
use rbl_backup::{manifest::Manifest, summary::Summary};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Inspected {
    pub manifest: Manifest,
    pub summary: Option<Summary>,
    /// The summary was worked out by reading the archive, rather than saved
    /// in it by RBXport.
    #[serde(default)]
    pub computed: bool,
}

/// A file as it was when inspected. A change of size or time is a new file.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
struct Key {
    path: PathBuf,
    bytes: u64,
    modified: u128,
}

impl Key {
    fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
        Some(Self { path: path.to_path_buf(), bytes: meta.len(), modified })
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    version: u32,
    entries: Vec<(Key, Inspected)>,
}

const VERSION: u32 = 1;

pub struct Catalog {
    file: PathBuf,
    entries: HashMap<Key, Inspected>,
}

impl Catalog {
    /// The catalog saved at `file`; empty if there is none or it is unreadable.
    pub fn load(file: PathBuf) -> Self {
        let entries = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
            .filter(|saved| saved.version == VERSION)
            .map(|saved| saved.entries.into_iter().collect())
            .unwrap_or_default();
        Self { file, entries }
    }

    pub fn get(&self, path: &Path) -> Option<Inspected> {
        self.entries.get(&Key::of(path)?).cloned()
    }

    pub fn insert(&mut self, path: &Path, inspected: Inspected) {
        if let Some(key) = Key::of(path) {
            self.entries.retain(|known, _| known.path != path);
            self.entries.insert(key, inspected);
        }
    }

    pub fn forget(&mut self, path: &Path) {
        self.entries.retain(|known, _| known.path != path);
    }

    /// Saves what is still true: entries whose file is unchanged.
    pub fn save(&mut self) {
        self.entries.retain(|key, _| Key::of(&key.path).as_ref() == Some(key));
        let saved = Saved { version: VERSION, entries: self.entries.iter().map(|(key, value)| (key.clone(), value.clone())).collect() };
        let write = || -> Result<(), Box<dyn std::error::Error>> {
            if let Some(parent) = self.file.parent() {
                rbl_core::durable::create_dir_all(parent)?;
            }
            rbl_core::durable::write(&self.file, &serde_json::to_vec(&saved)?)?;
            Ok(())
        };
        if let Err(error) = write() {
            tracing::warn!(%error, "could not save the backup catalog");
        }
    }
}

/// Reads an archive's manifest and saved summary, opening it once.
pub fn inspect(path: &Path) -> rbl_backup::Result<Inspected> {
    let mut zip = rbl_backup::archive::open(path)?;
    let manifest = Manifest::read_from(&mut zip)?;
    // A damaged summary only costs the quick view; the backup still restores.
    let summary = Summary::read_from(&mut zip).unwrap_or_else(|error| {
        tracing::warn!(%error, path = %path.display(), "ignoring an unreadable backup summary");
        None
    });
    Ok(Inspected { manifest, summary, computed: false })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn inspected() -> Inspected {
        Inspected {
            manifest: Manifest::parse(br#"{"version":2,"library":"/l/master.db","created_at":5,"bytes":9}"#).unwrap(),
            summary: None,
            computed: false,
        }
    }

    #[test]
    fn remembers_a_file_until_it_changes_and_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.zip");
        std::fs::write(&archive, b"one").unwrap();
        let file = dir.path().join("cache/catalog.json");
        let mut catalog = Catalog::load(file.clone());
        catalog.insert(&archive, inspected());
        catalog.save();
        let mut restarted = Catalog::load(file.clone());
        assert_eq!(restarted.get(&archive).unwrap().manifest.created_at, 5);
        std::fs::write(&archive, b"changed").unwrap();
        assert!(restarted.get(&archive).is_none());
        std::fs::remove_file(&archive).unwrap();
        restarted.save();
        assert!(Catalog::load(file).entries.is_empty());
    }
}
