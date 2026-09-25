//! The window's calls. Anything that touches the disk runs off the main
//! thread, and a panic comes back as an error rather than ending the app.
use crate::state::{AppState, BackupEntry, Failure, Folder, Outcome, RestoreProgress, Status};
use rbl_backup::{restore::Parts, summary::Summary};
use std::{path::PathBuf, sync::Arc};
use tauri::State;
use tauri_plugin_opener::OpenerExt as _;

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Outcome<T> + Send + 'static) -> Outcome<T> {
    tauri::async_runtime::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
            .unwrap_or_else(|_| Err(Failure::new("Something went wrong inside RBXport Restore.")))
    })
    .await
    .unwrap_or_else(|_| Err(Failure::new("Something went wrong inside RBXport Restore.")))
}

#[tauri::command]
pub async fn status(state: State<'_, Arc<AppState>>) -> Outcome<Status> {
    let state = Arc::clone(&state);
    blocking(move || Ok(state.status())).await
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri's State extractor is injected by value")]
pub fn backup_folder(state: State<'_, Arc<AppState>>) -> Folder {
    state.folder_shown()
}

/// Lists another folder's backups, or RBXport's own again without one.
#[tauri::command]
pub async fn set_backup_folder(state: State<'_, Arc<AppState>>, folder: Option<String>) -> Outcome<Folder> {
    let state = Arc::clone(&state);
    blocking(move || state.set_folder(folder.map(PathBuf::from).as_deref())).await
}

#[tauri::command]
pub async fn open_backup_folder<R: tauri::Runtime>(app: tauri::AppHandle<R>, state: State<'_, Arc<AppState>>) -> Outcome<()> {
    let folder = state.folder();
    blocking(move || {
        app.opener()
            .open_path(folder.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|e| Failure::new(format!("The backup folder could not be opened: {e}")))
    })
    .await
}

#[tauri::command]
pub async fn list_backups(state: State<'_, Arc<AppState>>) -> Outcome<Vec<BackupEntry>> {
    let state = Arc::clone(&state);
    blocking(move || state.list()).await
}

#[tauri::command]
pub async fn inspect_backup(state: State<'_, Arc<AppState>>, path: String) -> Outcome<BackupEntry> {
    let state = Arc::clone(&state);
    blocking(move || state.inspect(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn backup_summary(state: State<'_, Arc<AppState>>, path: String) -> Outcome<Summary> {
    let state = Arc::clone(&state);
    blocking(move || state.summary(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn library_summary(state: State<'_, Arc<AppState>>, refresh: Option<bool>) -> Outcome<Summary> {
    let state = Arc::clone(&state);
    blocking(move || state.library_summary(refresh.unwrap_or(false))).await
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri's State extractor is injected by value")]
pub fn start_restore(state: State<'_, Arc<AppState>>, path: String, parts: Parts) -> Outcome<()> {
    state.start_restore(&PathBuf::from(path), parts)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri's State extractor is injected by value")]
pub fn restore_progress(state: State<'_, Arc<AppState>>) -> RestoreProgress {
    state.restore_progress()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri's State extractor is injected by value")]
pub fn cancel_restore(state: State<'_, Arc<AppState>>) {
    state.cancel_restore();
}

#[tauri::command]
pub async fn recover_restore(state: State<'_, Arc<AppState>>) -> Outcome<()> {
    let state = Arc::clone(&state);
    blocking(move || state.recover()).await
}

#[tauri::command]
pub async fn delete_backup(state: State<'_, Arc<AppState>>, path: String) -> Outcome<()> {
    let state = Arc::clone(&state);
    blocking(move || state.delete(&PathBuf::from(path))).await
}
