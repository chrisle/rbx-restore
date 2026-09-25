import type { BackupEntry, BackupSizes, Counts, Parts } from "@/ipc/types";

/** The chart's segments, in RBXport's order and colours. */
export const SIZE_PARTS = [
  { key: "database", label: "Database", color: "var(--c-accent)" },
  { key: "waveforms", label: "Waveform previews", color: "var(--c-label-aqua)" },
  { key: "cues", label: "Memory & hot cues", color: "var(--c-label-orange)" },
  { key: "beatGrids", label: "Beat grids", color: "var(--c-label-purple)" },
  { key: "phrases", label: "Phrase analysis", color: "var(--c-label-pink)" },
  { key: "artwork", label: "Artwork thumbnails", color: "var(--c-label-green)" },
  { key: "vocals", label: "Vocal analysis", color: "var(--c-label-yellow)" },
  { key: "other", label: "Other analysis", color: "var(--c-text-dim)" },
] as const satisfies readonly { key: keyof BackupSizes; label: string; color: string }[];

export function totalSize(sizes: BackupSizes): number {
  return SIZE_PARTS.reduce((sum, part) => sum + sizes[part.key], 0);
}

export function analysisSize(sizes: BackupSizes): number {
  return sizes.waveforms + sizes.cues + sizes.beatGrids + sizes.phrases + sizes.vocals + sizes.other;
}

/** The rows of the comparison, in the order people check them. */
export const COUNT_ROWS = [
  { key: "tracks", label: "Tracks" },
  { key: "playlists", label: "Playlists" },
  { key: "smartPlaylists", label: "Intelligent playlists" },
  { key: "playlistFolders", label: "Playlist folders" },
  { key: "hotCues", label: "Hot cues" },
  { key: "memoryCues", label: "Memory cues" },
  { key: "myTags", label: "My Tags" },
  { key: "historySessions", label: "History playlists" },
  { key: "analyzedTracks", label: "Analyzed tracks" },
  { key: "analysisFiles", label: "Analysis files" },
  { key: "artworkFiles", label: "Artwork images" },
] as const satisfies readonly { key: keyof Counts; label: string }[];

export interface RestorePart {
  key: keyof Parts;
  label: string;
  /** As it reads mid-sentence. */
  phrase: string;
  detail: string;
  bytes: (sizes: BackupSizes) => number | null;
  held: (entry: BackupEntry) => boolean;
}

/** What can be restored on its own. */
export const RESTORE_PARTS: readonly RestorePart[] = [
  {
    key: "database", label: "Library database", phrase: "the library database",
    detail: "Tracks, playlists, My Tags, ratings, comments, hot cues, memory cues and history.",
    bytes: (sizes) => sizes.database, held: () => true,
  },
  {
    key: "analysis", label: "Analysis files", phrase: "analysis files",
    detail: "Beat grids, waveforms, phrase and vocal analysis, and the cue points players read.",
    bytes: analysisSize, held: () => true,
  },
  {
    key: "artwork", label: "Artwork", phrase: "artwork",
    detail: "Album art and its thumbnails.",
    bytes: (sizes) => sizes.artwork, held: (entry) => entry.includesArtwork,
  },
  {
    key: "libraryFiles", label: "Sync Manager and Automix selections", phrase: "Sync Manager and Automix selections",
    detail: "Which playlists Sync Manager keeps on your devices, and the Automix playlist.",
    bytes: () => null, held: (entry) => entry.libraryFiles.length > 0,
  },
];

/** What happens to the parts left out, when that matters. */
export function partialRestoreNotes(parts: Parts): string[] {
  const notes: string[] = [];
  if (parts.database && !parts.analysis) {
    notes.push("Analysis files stay as they are now, so tracks you changed since this backup may have beat grids and waveforms that don’t match the restored library.");
  }
  if (parts.analysis && !parts.database) {
    notes.push("The library database stays as it is now. Tracks added or analyzed since this backup lose their analysis and need analyzing again.");
  }
  return notes;
}

/** "the library database and analysis files" */
export function describeParts(parts: Parts): string {
  const names = RESTORE_PARTS.filter((part) => parts[part.key]).map((part) => part.phrase);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
