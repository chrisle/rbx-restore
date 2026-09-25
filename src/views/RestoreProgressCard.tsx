import type { RestoreProgress } from "@/ipc/types";
import { Button } from "@/components/controls";
import { formatBytes } from "@/lib/format";
import styles from "./RestorePane.module.css";

const DETAILS: Record<string, string> = {
  preparing: "Checking the backup and your library.",
  validating: "Checking the restored database before it replaces yours.",
  replacing: "Putting the restored files in place. This can’t be stopped now.",
  stopping: "Removing the unfinished restore. Your library is unchanged.",
};

/** A restore in progress, drawn as RBXport draws a backup in progress. */
export function RestoreProgressCard({ progress, onStop }: { progress: RestoreProgress; onStop: () => void }) {
  const unpacking = progress.phase === "unpacking" && progress.totalBytes > 0;
  const percent = Math.min(100, Math.max(0, Math.floor(progress.doneBytes / (progress.totalBytes || 1) * 100)));
  const stopping = progress.phase === "stopping";
  const replacing = progress.phase === "replacing";
  return <section className={`${styles.summary} ${styles.activeRestore}`} aria-label="Restoring your library">
    <div className={styles.restoreProgress}>
      <div className={styles.progressHeading} role="status" aria-live="polite">
        <strong>Restoring your library</strong>
        {unpacking ? <span className={styles.percent}>{percent}%</span> : null}
      </div>
      <progress className={styles.progressBar} aria-label="Restore progress" max={100} value={unpacking ? percent : undefined} />
      <div className={styles.progressDetails}>
        {unpacking ? `${formatBytes(progress.doneBytes)} of ${formatBytes(progress.totalBytes)}` : DETAILS[progress.phase] ?? DETAILS.preparing}
      </div>
      {!stopping && progress.currentItem ? <div className={styles.currentItem} title={progress.currentItem} aria-label="Current restore item">
        {progress.currentItem}
      </div> : null}
      <div className={styles.progressFooter}>
        <p>Keep rekordbox and RBXport closed until this finishes.</p>
        <Button className={styles.backupButton} disabled={stopping || replacing} onClick={onStop}>{stopping ? "Stopping…" : "Stop restore"}</Button>
      </div>
    </div>
  </section>;
}
