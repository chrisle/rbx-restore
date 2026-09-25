import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { getBackend } from "@/ipc/client";
import type { BackupEntry, Parts, Summary } from "@/ipc/types";
import { Button, Checkbox } from "@/components/controls";
import { errorMessage } from "@/lib/errorMessage";
import { formatBytes, formatCount } from "@/lib/format";
import { COUNT_ROWS, RESTORE_PARTS, describeParts, partialRestoreNotes } from "@/lib/parts";
import { SizeChart } from "./SizeChart";
import styles from "./RestorePane.module.css";

/** Everything the backup holds, ticked. */
function allParts(entry: BackupEntry): Parts {
  return {
    database: true,
    analysis: true,
    artwork: entry.includesArtwork,
    libraryFiles: entry.libraryFiles.length > 0,
  };
}

function Delta({ backup, now }: { backup: number; now: number | undefined }) {
  if (now === undefined) return <td className={styles.dim}>—</td>;
  const difference = now - backup;
  return <td className={difference === 0 ? undefined : styles.changed}>
    {formatCount(now)}
    {difference === 0 ? null : <span className={styles.delta}>{difference > 0 ? "+" : "−"}{formatCount(Math.abs(difference))}</span>}
  </td>;
}

/**
 * A backup opened up: the size of each kind of data, the counts beside the
 * library's as it is now, and the parts to restore.
 */
export function BackupDetails({ entry, library, blocked, focus, onStart, onSummary }: {
  entry: BackupEntry;
  /** The library now, for comparison; null until measured. */
  library: Summary | null;
  /** Why a restore cannot start now, if it cannot. */
  blocked: string;
  /** Bring the restore choices into view, as the row's Restore… asks. */
  focus: boolean;
  onStart: (entry: BackupEntry, parts: Parts) => Promise<void>;
  onSummary: (entry: BackupEntry, summary: Summary) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(entry.summary);
  const [failed, setFailed] = useState("");
  const [parts, setParts] = useState<Parts>(() => allParts(entry));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const choices = useRef<HTMLFieldSetElement>(null);
  // Read through a ref: a new callback must not start the reading again.
  const current = useRef({ entry, onSummary });
  current.current = { entry, onSummary };
  const saved = entry.summary;
  const path = entry.path;
  useEffect(() => {
    if (saved) { setSummary(saved); return; }
    let live = true;
    setFailed("");
    void getBackend().then(b => b.backupSummary(path)).then(read => {
      if (!live) return;
      setSummary(read);
      current.current.onSummary(current.current.entry, read);
    }).catch(e => { if (live) setFailed(errorMessage(e)); });
    return () => { live = false; };
  }, [path, saved]);
  useEffect(() => {
    if (focus) choices.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);
  const created = new Date(entry.createdAt).toLocaleString();
  const chosen = RESTORE_PARTS.some(part => parts[part.key]);
  const reason = blocked || (!entry.belongsToLibrary ? "This backup belongs to another rekordbox library." : "");
  const start = async () => {
    setError("");
    const backend = await getBackend();
    const what = describeParts(parts);
    const message = `Restore ${what} from the backup of ${created}?\n\n${entry.path}\n\nThis replaces ${what} in your rekordbox library with the backup’s. Changes made since then will be lost.`;
    if (!await backend.confirm(message, { yes: "Restore", no: "Cancel" })) return;
    setStarting(true);
    try { await onStart(entry, parts); }
    catch (e) { setError(errorMessage(e)); }
    finally { setStarting(false); }
  };
  return <div className={styles.details} aria-label={`Backup from ${created}`}>
    {summary ? <SizeChart title="Backup contents" label="Backup contents" sizes={summary.sizes} loading={false} loadingText="" />
      : failed ? <p className={styles.error} role="alert">Couldn’t read this backup: {failed}</p>
      : <p className={styles.reading} role="status">
        <LoaderCircle size={16} className={styles.sizeSpinner} aria-hidden="true" />
        Reading this backup. It was made before backups included a summary, so this takes a moment.
      </p>}
    <div className={styles.detailGrid}>
      <div>
        {summary ? <table className={styles.counts} aria-label="What this backup holds">
          <thead><tr><th scope="col">Library</th><th scope="col">In this backup</th><th scope="col">In your library now</th></tr></thead>
          <tbody>{COUNT_ROWS.map(row => <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{formatCount(summary.counts[row.key])}</td>
            <Delta backup={summary.counts[row.key]} now={library?.counts[row.key]} />
          </tr>)}</tbody>
        </table> : null}
        <dl className={styles.facts}>
          <dt>Created</dt><dd>{created}</dd>
          <dt>File</dt><dd>{entry.path}</dd>
          <dt>Size</dt><dd>{formatBytes(entry.bytes)} compressed</dd>
          {summary?.appVersion ? <><dt>Made by</dt><dd>RBXport {summary.appVersion}</dd></> : null}
          {!entry.belongsToLibrary ? <><dt>Library</dt><dd className={styles.error}>{entry.library}</dd></> : null}
        </dl>
      </div>
      <fieldset className={styles.choices} ref={choices} disabled={starting}>
        <legend>What to restore</legend>
        {RESTORE_PARTS.map(part => {
          const held = part.held(entry);
          const bytes = summary ? part.bytes(summary.sizes) : null;
          return <label key={part.key} className={styles.choice} data-absent={held ? undefined : true}>
            <Checkbox label={part.label} checked={held && parts[part.key]} disabled={!held}
              onChange={checked => setParts(current => ({ ...current, [part.key]: checked }))} />
            <strong>{part.label}</strong>
            <span className={styles.size}>{held ? bytes === null ? "" : formatBytes(bytes) : "Not in this backup"}</span>
            <span className={styles.choiceDetail}>{part.detail}</span>
          </label>;
        })}
        {partialRestoreNotes(parts).map(note => <p key={note} className={styles.partialNote}>{note}</p>)}
        <div className={styles.restoreActions}>
          <p role="status">{error ? <span className={styles.error}>{error}</span> : reason}</p>
          <Button className={styles.backupButton} disabled={!chosen || starting || reason !== ""} onClick={() => void start()}>
            {starting ? "Starting…" : "Restore selected…"}
          </Button>
        </div>
      </fieldset>
    </div>
  </div>;
}
