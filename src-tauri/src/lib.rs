//! RBXport Restore: shows what each RBXport backup holds and puts it back as
//! the rekordbox library, all of it or only some parts. Reading and restoring
//! archives is `rbl_backup`'s; this is the window around it.
mod catalog;
mod commands;
mod processes;
mod state;

use std::sync::Arc;
use tauri::Manager as _;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dirs = std::env::var_os(state::DATA_DIR_ENV)
                .map(std::path::PathBuf::from)
                .map_or_else(
                    || Ok::<_, tauri::Error>((app.path().app_data_dir()?, app.path().app_cache_dir()?)),
                    |dir| Ok((dir.join("data"), dir.join("cache"))),
                )?;
            let state = Arc::new(state::AppState::new(rbl_backup::state_dir(), dirs.0, dirs.1));
            app.manage(Arc::clone(&state));
            // An interrupted restore is finished or rolled back before anything
            // else reads the library. If rekordbox is running this is refused,
            // and the window says so until it can be done.
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = state.recover() {
                    tracing::warn!(error = %error.message, "could not recover an interrupted restore yet");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::backup_folder,
            commands::set_backup_folder,
            commands::open_backup_folder,
            commands::list_backups,
            commands::inspect_backup,
            commands::backup_summary,
            commands::library_summary,
            commands::start_restore,
            commands::restore_progress,
            commands::cancel_restore,
            commands::recover_restore,
            commands::delete_backup,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        tracing::error!(%error, "RBXport Restore could not start");
    }
}
