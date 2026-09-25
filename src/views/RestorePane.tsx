import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { getBackend } from "@/ipc/client";
import type { Backend, BackupEntry, Folder, Parts, RestoreProgress, Status, Summary } from "@/ipc/types";
import { Button, Section } from "@/components/controls";
import { errorMessage } from "@/lib/errorMessage";
import { formatBytes, formatCount } from "@/lib/format";
import { useRestoreJob } from "@/store/useRestoreJob";
import { useStatus } from "@/store/useStatus";
import { BackupDetails } from "./BackupDetails";
import { LibraryData } from "./LibraryData";
import { RestoreProgressCard } from "./RestoreProgressCard";
import styles from "./RestorePane.module.css";

/** Why a restore cannot start now, or "". */
export function blockedReason(status: Status | null, running: boolean): string {
  if (running) return "A restore is running.";
  if (!status) return "Checking whether a restore can run…";
  if (status.libraryError) return status.libraryError;
  if (status.restorePending) return "Finish the interrupted restore first.";
  if (status.rekordboxRunning) return "Quit rekordbox before restoring a backup.";
  if (status.rbxportRunning) return "Quit RBXport before restoring a backup.";
  if (status.analysisEditPending) return "Open RBXport once so it can finish an analysis edit, then quit it.";
  return "";
}

function finishedMessage(progress: RestoreProgress): { text: string; failed: boolean } {
  switch (progress.phase) {
    case "complete": return { text: "Backup restored. Open rekordbox to see your library.", failed: false };
    case "cancelled": return { text: "Restore stopped. Your library was not changed.", failed: false };
    case "failed": return { text: progress.error ?? "The restore failed.", failed: true };
    default: return { text: "", failed: false };
  }
}

export function RestorePane() {
  const { status, refresh: refreshStatus } = useStatus();
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [focus, setFocus] = useState("");
  const [picked, setPicked] = useState<BackupEntry | null>(null);
  const [library, setLibrary] = useState<Summary | null>(null);
  const [libraryRequest, setLibraryRequest] = useState({ attempt: 0, refresh: false });
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const running = useRef(false);

  const load = useCallback(async (backend: Backend) => {
    const [entries, shown] = await Promise.all([backend.listBackups(), backend.backupFolder()]);
    setBackups(entries);
    setFolder(shown);
  }, []);
  useEffect(() => {
    let live = true;
    void getBackend().then(b => Promise.all([b.listBackups(), b.backupFolder()])).then(([entries, shown]) => {
      if (live) { setBackups(entries); setFolder(shown); }
    }).catch(e => { if (live) setError(errorMessage(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    setLibraryLoading(true);
    setLibraryFailed(false);
    void getBackend().then(b => b.librarySummary(libraryRequest.refresh)).then(value => {
      if (live) setLibrary(value);
    }).catch(() => { if (live) setLibraryFailed(true); })
      .finally(() => { if (live) setLibraryLoading(false); });
    return () => { live = false; };
  }, [libraryRequest]);
  const measureLibrary = useCallback(() => setLibraryRequest(value => ({ attempt: value.attempt + 1, refresh: true })), []);

  const job = useRestoreJob(useCallback((progress: RestoreProgress) => {
    const done = finishedMessage(progress);
    if (done.failed) { setError(done.text); setMessage(""); } else { setMessage(done.text); setError(""); }
    refreshStatus();
    // The library has changed; measure it again for the comparison.
    if (progress.phase === "complete") measureLibrary();
  }, [refreshStatus, measureLibrary]));

  const run = async (label: string, action: (backend: Backend) => Promise<string>) => {
    if (running.current) return;
    running.current = true;
    setBusy(label); setError(""); setMessage("");
    try {
      const backend = await getBackend();
      setMessage(await action(backend));
      await load(backend);
    } catch (e) { setError(errorMessage(e)); }
    finally { running.current = false; setBusy(""); }
  };
  const start = useCallback(async (entry: BackupEntry, parts: Parts) => {
    setError(""); setMessage("");
    await job.start(entry.path, parts);
  }, [job]);
  const remember = useCallback((entry: BackupEntry, summary: Summary) => {
    setBackups(current => current.map(item => item.path === entry.path ? { ...item, summary, summaryComputed: true } : item));
  }, []);
  const toggle = (path: string, open?: boolean) => setExpanded(current => {
    const next = new Set(current);
    if (open ?? !next.has(path)) next.add(path); else next.delete(path);
    return next;
  });

  const blocked = blockedReason(status, job.progress.running);
  const unavailable = loading || busy !== "" || job.progress.running;
  return <Section title="Restore a Backup">
    {status?.rekordboxRunning ? <p className={styles.blockedNotice}>Quit rekordbox before restoring a backup.</p> : null}
    {status?.rbxportRunning ? <p className={styles.blockedNotice}>Quit RBXport before restoring a backup.</p> : null}
    {status?.libraryError ? <p className={styles.blockedNotice}>{status.libraryError}</p> : null}
    {status?.restorePending ? <p className={styles.notice}>
      A restore was interrupted before it finished. Your library needs to be put back as it was before anything else.
      <Button className={styles.backupButton} disabled={busy !== "" || status.rekordboxRunning || status.rbxportRunning}
        onClick={() => void run("Finishing the interrupted restore…", async b => {
          await b.recoverRestore(); refreshStatus(); measureLibrary(); return "The interrupted restore was undone.";
        })}>Finish now</Button>
    </p> : null}
    {status?.analysisEditPending ? <p className={styles.notice}>RBXport has an analysis edit it hasn’t finished. Open RBXport once so it can finish it, then quit it before restoring.</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}

    <LibraryData summary={library} loading={libraryLoading} failed={libraryFailed} onRefresh={measureLibrary} />

    {job.progress.running ? <RestoreProgressCard progress={job.progress} onStop={() => void job.stop().catch(e => setError(errorMessage(e)))} />
      : <section className={styles.summary} aria-label="Restore your library">
        <div>
          <strong>Restore your Library</strong>
          <p className={styles.help}>Open a backup to see what it holds, then restore all of it or only the parts you choose.</p>
          <p className={styles.status} role="status" aria-live="polite" data-done={message ? true : undefined}>{busy || message}</p>
        </div>
      </section>}

    <section className={styles.destination} aria-label="Backup folder">
      <div>
        <strong>Backup folder</strong>
        {folder ? <button type="button" role="link" className={styles.directoryLink} onClick={() => {
          setError("");
          void getBackend().then(b => b.openBackupFolder()).catch(e => setError(errorMessage(e)));
        }}>{folder.path}</button> : <p className={styles.help}>Loading folder…</p>}
        <p className={styles.help}>{folder?.chosen ? "Chosen here. RBXport still saves new backups to its own folder." : "Where RBXport saves new backups."}</p>
      </div>
      <div className={styles.buttons}>
        {folder?.chosen ? <Button className={styles.backupButton} disabled={unavailable} onClick={() => void run("Opening RBXport’s folder…", async b => {
          setFolder(await b.setBackupFolder(null)); setExpanded(new Set()); return "";
        })}>Use RBXport’s folder</Button> : null}
        <Button className={styles.backupButton} disabled={unavailable} onClick={() => void run("Choosing a backup folder…", async b => {
          const chosen = await b.pickFolder("Choose a folder of RBXport backups");
          if (!chosen) return "";
          setFolder(await b.setBackupFolder(chosen)); setExpanded(new Set());
          return "";
        })}>Change folder…</Button>
      </div>
    </section>

    <h4 className={`${styles.sectionHeading} ${styles.savedHeading}`}>Saved backups</h4>
    {loading ? <p className={styles.status} role="status">Loading backups…</p> : null}
    {!loading && backups.length === 0 ? <div className={styles.empty}>
      <strong>{error ? "Backups unavailable" : "No backups in this folder."}</strong>
      <p>{error ? "Reopen RBXport Restore to try again." : "Create a backup in RBXport, choose another folder, or open a backup ZIP below."}</p>
    </div> : null}
    {backups.length > 0 ? <div className={styles.tableScroll}><table className={styles.table} aria-label="Library backups">
      <thead><tr><th><span hidden>Details</span></th><th>Date</th><th>Time</th><th>Size</th><th>Tracks</th><th>Actions</th></tr></thead>
      <tbody>{backups.map(backup => {
        const created = new Date(backup.createdAt);
        const open = expanded.has(backup.path);
        return <Fragment key={backup.path}>
          <tr className={styles.row} data-expanded={open || undefined} onClick={() => toggle(backup.path)}>
            <td>
              <button type="button" className={styles.expander} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what the backup from ${created.toLocaleString()} holds`}
                onClick={event => { event.stopPropagation(); toggle(backup.path); }}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </td>
            <td><time dateTime={created.toISOString()}>{created.toLocaleDateString()}</time></td>
            <td><time dateTime={created.toISOString()}>{created.toLocaleTimeString()}</time></td>
            <td className={styles.size}>{formatBytes(backup.bytes)}</td>
            <td className={styles.size}>{backup.summary ? formatCount(backup.summary.counts.tracks) : <span className={styles.dim}>—</span>}</td>
            <td onClick={event => event.stopPropagation()}><div className={styles.actions}>
              <Button className={styles.backupButton} disabled={unavailable} onClick={() => { toggle(backup.path, true); setFocus(backup.path); }}>Restore…</Button>
              <Button className={`${styles.backupButton} ${styles.deleteButton}`} disabled={unavailable} onClick={() => void run("Deleting backup…", async b => {
                if (!await b.confirm(`Delete the backup from ${created.toLocaleString()}? This cannot be undone.`, { yes: "Delete", no: "Cancel" })) return "";
                await b.deleteBackup(backup.path); return "Backup deleted.";
              })}>Delete</Button>
            </div></td>
          </tr>
          {open ? <tr className={styles.detailsRow}><td colSpan={6}>
            <BackupDetails entry={backup} library={library} blocked={blocked} focus={focus === backup.path} onStart={start} onSummary={remember} />
          </td></tr> : null}
        </Fragment>;
      })}</tbody>
    </table></div> : null}

    <section className={`${styles.destination} ${styles.restoreFile}`} aria-label="Restore a backup file">
      <div>
        <h4 className={styles.sectionHeading}>Restore a backup file</h4>
        <p className={styles.help}>Choose a backup ZIP saved anywhere on your computer or an external drive.</p>
      </div>
      <Button className={styles.backupButton} disabled={unavailable} onClick={() => void run("Opening the backup…", async b => {
        const path = await b.pickZip();
        if (!path) return "";
        setPicked(await b.inspectBackup(path));
        return "";
      })}>Choose ZIP…</Button>
    </section>
    {picked ? <section className={styles.fileCard} aria-label="Chosen backup file">
      <div className={styles.fileCardHeading}>
        <strong>{picked.name}</strong>
        <Button className={styles.backupButton} onClick={() => setPicked(null)}>Close</Button>
      </div>
      <BackupDetails entry={picked} library={library} blocked={blocked} focus onStart={start}
        onSummary={(_, summary) => setPicked(current => current ? { ...current, summary } : current)} />
    </section> : null}
  </Section>;
}
