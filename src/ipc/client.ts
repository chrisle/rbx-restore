import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Backend, BackupEntry, Folder, Parts, RestoreProgress, Status, Summary } from "./types";

function tauriBackend(): Backend {
  return {
    status: () => invoke<Status>("status"),
    backupFolder: () => invoke<Folder>("backup_folder"),
    setBackupFolder: (folder) => invoke<Folder>("set_backup_folder", { folder }),
    openBackupFolder: () => invoke<void>("open_backup_folder"),
    listBackups: () => invoke<BackupEntry[]>("list_backups"),
    inspectBackup: (path) => invoke<BackupEntry>("inspect_backup", { path }),
    backupSummary: (path) => invoke<Summary>("backup_summary", { path }),
    librarySummary: (refresh = false) => invoke<Summary>("library_summary", { refresh }),
    startRestore: (path, parts: Parts) => invoke<void>("start_restore", { path, parts }),
    restoreProgress: () => invoke<RestoreProgress>("restore_progress"),
    cancelRestore: () => invoke<void>("cancel_restore"),
    recoverRestore: () => invoke<void>("recover_restore"),
    deleteBackup: (path) => invoke<void>("delete_backup", { path }),
    pickFolder: async (title) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, directory: true, title });
      // Cancelling is a normal outcome, not an error.
      return typeof picked === "string" ? picked : null;
    },
    pickZip: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, directory: false, title: "Choose a backup ZIP",
        filters: [{ name: "RBXport backup ZIP", extensions: ["zip"] }] });
      return typeof picked === "string" ? picked : null;
    },
    confirm: async (message, labels) => {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      return ask(message, { kind: "warning", ...(labels ? { okLabel: labels.yes, cancelLabel: labels.no } : {}) });
    },
  };
}

let backend: Promise<Backend> | null = null;

/** The app's backend, or a stand-in when the page runs in a browser. */
export function getBackend(): Promise<Backend> {
  backend ??= isTauri() ? Promise.resolve(tauriBackend()) : import("./mock").then((mock) => mock.createMockBackend());
  return backend;
}
