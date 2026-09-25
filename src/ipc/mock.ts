/**
 * A stand-in backend for the browser, so the window can be designed and
 * tested without a library. Query flags set the situation:
 * `?rekordbox=1` and `?rbxport=1` have those apps running,
 * `?pending=1` has an interrupted restore, `?fail=1` fails restores, and
 * `?decline=1` answers no to every confirmation.
 */
import type { Backend, BackupEntry, Counts, Parts, RestoreProgress, Status, Summary } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const LIBRARY = "/Users/mock/Library/Pioneer/rekordbox/master.db";

function flag(name: string): boolean {
  return new URLSearchParams(globalThis.location?.search ?? "").get(name) === "1";
}

function wait<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function summary(createdAt: number, scale: number, counts: Partial<Counts> = {}, appVersion: string | null = "0.16.0"): Summary {
  const tracks = Math.round(38_705 * scale);
  return {
    version: 1,
    createdAt,
    appVersion,
    sizes: {
      updatedAt: createdAt, trackCount: tracks,
      database: Math.round(1.77 * GB * scale), waveforms: Math.round(9.52 * GB * scale), cues: Math.round(4.85 * MB * scale),
      beatGrids: Math.round(206.6 * MB * scale), phrases: Math.round(16 * MB * scale), artwork: Math.round(1.4 * GB * scale),
      vocals: Math.round(223 * MB * scale), other: Math.round(357.7 * MB * scale),
    },
    counts: {
      tracks, analyzedTracks: tracks - 1, playlists: Math.round(620 * scale), smartPlaylists: 4, playlistFolders: 56,
      hotCues: Math.round(168_615 * scale), memoryCues: Math.round(140_073 * scale), myTags: 95, historySessions: 181,
      analysisFiles: Math.round(149_953 * scale), artworkFiles: Math.round(62_352 * scale), ...counts,
    },
  };
}

interface Stored { entry: BackupEntry; summary: Summary; reading?: Promise<Summary> }

export function createMockBackend(): Backend {
  const now = Date.now();
  const folder = "/Users/mock/Library/Application Support/rbxport/backups";
  let current = summary(now - 2 * 60 * 60 * 1000, 1.004, { playlists: 624, hotCues: 169_020 });
  const backup = (name: string, createdAt: number, stored: Summary, options: Partial<BackupEntry> = {}): Stored => ({
    summary: stored,
    entry: {
      path: `${options.path ?? folder}/${name}`, name, bytes: Math.round(stored.sizes.database * 0.35 + stored.sizes.waveforms * 0.62 + stored.sizes.artwork * 0.97),
      createdAt, includesArtwork: true, libraryFiles: ["masterPlaylists6.xml", "automixPlaylist6.xml"], library: LIBRARY,
      belongsToLibrary: true, summary: options.summaryComputed === undefined ? stored : null, summaryComputed: false, ...options,
    },
  });
  const backups = new Map<string, Stored>();
  for (const item of [
    backup("rbexport-20260923-2210.zip", now - 1 * DAY, summary(now - 1 * DAY, 1.0)),
    backup("rbexport-20260916-1905.zip", now - 8 * DAY, summary(now - 8 * DAY, 0.97, { playlists: 598 })),
    backup("library-1789983764244.zip", now - 23 * DAY, summary(now - 23 * DAY, 0.93, {}, null), { summaryComputed: false }),
    backup("rbexport-20260801-0930.zip", now - 54 * DAY, summary(now - 54 * DAY, 0.4), { library: "/Users/old-mac/Library/Pioneer/rekordbox/master.db", belongsToLibrary: false }),
  ]) backups.set(item.entry.path, item);
  const elsewhere = backup("My library before the tour.zip", now - 120 * DAY, summary(now - 120 * DAY, 0.81), { path: "/Volumes/Backup Drive" });

  let listed = folder;
  let pending = flag("pending");
  let progress: RestoreProgress = { running: false, phase: "", doneBytes: 0, totalBytes: 0, currentItem: null, error: null, path: null, parts: null };
  const status = (): Status => ({
    library: LIBRARY, libraryError: null, rekordboxRunning: flag("rekordbox"), rbxportRunning: flag("rbxport"),
    analysisEditPending: false, restorePending: pending,
  });
  const find = (path: string) => backups.get(path) ?? (path === elsewhere.entry.path ? elsewhere : undefined);
  const refuse = (message: string) => Promise.reject(new Error(message));

  const run = (item: Stored, parts: Parts) => {
    const s = item.summary.sizes;
    const total = (parts.database ? s.database : 0) + (parts.artwork ? s.artwork : 0)
      + (parts.analysis ? s.waveforms + s.cues + s.beatGrids + s.phrases + s.vocals + s.other : 0);
    const files = ["Database · master.db", "Analysis files · USBANLZ/P016/0000A1B2/ANLZ0000.EXT", "Artwork · Artwork/00B/2c1f/artwork_m.jpg"];
    let step = 0;
    const tick = () => {
      if (progress.phase === "stopping") {
        progress = { ...progress, running: false, phase: "cancelled", currentItem: null };
        return;
      }
      step += 1;
      if (step <= 12) {
        progress = { ...progress, phase: "unpacking", doneBytes: Math.round(total * step / 12), totalBytes: total, currentItem: files[step % files.length] ?? null };
        setTimeout(tick, 250);
      } else if (step === 13 && parts.database) {
        progress = { ...progress, phase: "validating", currentItem: "Checking database · master.db" };
        setTimeout(tick, 400);
      } else if (step <= 14) {
        step = 14;
        progress = { ...progress, phase: "replacing", currentItem: "Replacing library files" };
        setTimeout(tick, 400);
      } else if (flag("fail")) {
        progress = { ...progress, running: false, phase: "failed", currentItem: null, error: "The backup is damaged and cannot be restored: Analysis files · USBANLZ/P016/0000A1B2/ANLZ0000.EXT did not unpack correctly." };
      } else {
        progress = { ...progress, running: false, phase: "complete", currentItem: null };
        current = { ...item.summary, createdAt: Date.now(), appVersion: null };
      }
    };
    setTimeout(tick, 300);
  };

  return {
    status: () => wait(status()),
    backupFolder: () => wait({ path: listed, chosen: listed !== folder }),
    setBackupFolder: (next) => { listed = next ?? folder; return wait({ path: listed, chosen: listed !== folder }); },
    openBackupFolder: () => wait(undefined),
    listBackups: () => wait([...backups.values()].filter(({ entry }) => entry.path.startsWith(`${listed}/`)).map(({ entry }) => ({ ...entry })), 200),
    inspectBackup: (path) => { const item = find(path); return item ? wait({ ...item.entry }) : refuse("This file is not an RBXport backup."); },
    backupSummary: (path) => {
      const item = find(path);
      if (!item) return refuse("Backup not found.");
      if (item.entry.summary) return wait(item.summary);
      // An older backup is read in full once; that takes a while.
      item.reading ??= wait(item.summary, 2500).then((read) => {
        item.entry = { ...item.entry, summary: read, summaryComputed: true };
        return read;
      });
      return item.reading;
    },
    librarySummary: () => wait(current, 700),
    startRestore: (path, parts) => {
      const item = find(path);
      if (!item) return refuse("Backup not found.");
      if (flag("rekordbox")) return refuse("rekordbox is running. Quit it before making changes.");
      if (flag("rbxport")) return refuse("Quit RBXport before restoring a backup.");
      if (progress.running) return refuse("A restore is already running.");
      progress = { running: true, phase: "preparing", doneBytes: 0, totalBytes: 0, currentItem: "Checking the backup", error: null, path, parts };
      run(item, parts);
      return wait(undefined);
    },
    restoreProgress: () => wait({ ...progress }, 10),
    cancelRestore: () => {
      if (progress.running && progress.phase !== "replacing") progress = { ...progress, phase: "stopping" };
      return wait(undefined);
    },
    recoverRestore: () => { pending = false; return wait(undefined, 400); },
    deleteBackup: (path) => { backups.delete(path); return wait(undefined); },
    pickFolder: () => wait("/Volumes/Backup Drive"),
    pickZip: () => wait(elsewhere.entry.path),
    // A browser dialog would stop automated checks; `?decline=1` answers no.
    confirm: () => wait(!flag("decline")),
  };
}
