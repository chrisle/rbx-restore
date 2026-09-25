/** Logical bytes by kind, as RBXport measures them for the Rekordbox Data bar. */
export interface BackupSizes {
  updatedAt: number;
  trackCount: number;
  artwork: number;
  vocals: number;
  database: number;
  waveforms: number;
  cues: number;
  beatGrids: number;
  phrases: number;
  other: number;
}

/** Library contents; live rows only. */
export interface Counts {
  tracks: number;
  analyzedTracks: number;
  playlists: number;
  smartPlaylists: number;
  playlistFolders: number;
  hotCues: number;
  memoryCues: number;
  myTags: number;
  historySessions: number;
  analysisFiles: number;
  artworkFiles: number;
}

/** What a backup, or the library now, holds. */
export interface Summary {
  version: number;
  createdAt: number;
  /** The RBXport that made the backup; null when worked out afterwards. */
  appVersion: string | null;
  sizes: BackupSizes;
  counts: Counts;
}

export interface BackupEntry {
  path: string;
  name: string;
  /** The ZIP's size on disk. */
  bytes: number;
  createdAt: number;
  includesArtwork: boolean;
  libraryFiles: string[];
  /** The master.db the backup was taken from. */
  library: string;
  belongsToLibrary: boolean;
  /** Saved in the backup, or worked out earlier; null until read. */
  summary: Summary | null;
  summaryComputed: boolean;
}

/** Whether a restore can run, and what is in its way. */
export interface Status {
  library: string | null;
  libraryError: string | null;
  rekordboxRunning: boolean;
  rbxportRunning: boolean;
  analysisEditPending: boolean;
  restorePending: boolean;
}

export interface Folder {
  path: string;
  /** Chosen in this app, rather than RBXport's Default backup folder. */
  chosen: boolean;
}

export interface Parts {
  database: boolean;
  analysis: boolean;
  artwork: boolean;
  libraryFiles: boolean;
}

export type RestorePhase = "" | "preparing" | "unpacking" | "validating" | "replacing" | "stopping" | "complete" | "cancelled" | "failed";

export interface RestoreProgress {
  running: boolean;
  phase: RestorePhase;
  doneBytes: number;
  totalBytes: number;
  currentItem: string | null;
  error: string | null;
  path: string | null;
  parts: Parts | null;
}

export interface Backend {
  status(): Promise<Status>;
  /** The folder whose backups are listed. */
  backupFolder(): Promise<Folder>;
  /** Lists another folder, or RBXport's own again with null. */
  setBackupFolder(folder: string | null): Promise<Folder>;
  openBackupFolder(): Promise<void>;
  listBackups(): Promise<BackupEntry[]>;
  inspectBackup(path: string): Promise<BackupEntry>;
  /** Slow for a backup made before summaries: it is read in full. */
  backupSummary(path: string): Promise<Summary>;
  librarySummary(refresh?: boolean): Promise<Summary>;
  startRestore(path: string, parts: Parts): Promise<void>;
  restoreProgress(): Promise<RestoreProgress>;
  cancelRestore(): Promise<void>;
  recoverRestore(): Promise<void>;
  deleteBackup(path: string): Promise<void>;
  pickFolder(title: string): Promise<string | null>;
  pickZip(): Promise<string | null>;
  confirm(message: string, labels?: { yes: string; no: string }): Promise<boolean>;
}
