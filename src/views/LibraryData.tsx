import type { Summary } from "@/ipc/types";
import { Button } from "@/components/controls";
import { SizeChart } from "./SizeChart";
import { UpdatedTime } from "./UpdatedTime";
import styles from "./RestorePane.module.css";

/** The library as it is now, as RBXport's Backups pane shows it. */
export function LibraryData({ summary, loading, failed, onRefresh }: {
  summary: Summary | null;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  return <SizeChart title="Rekordbox Data" label="Rekordbox data now" sizes={summary?.sizes ?? null} loading={loading}
    loadingText="Calculating Rekordbox data size"
    failed={failed ? "Couldn’t calculate Rekordbox data size. Click Refresh to try again." : null}
    footer={<>
      <span>Updates sizes weekly · Last updated: {summary ? <UpdatedTime key={summary.createdAt} timestamp={summary.createdAt} /> : "—"}</span>
      <Button className={styles.backupButton} disabled={loading} onClick={onRefresh}>Refresh</Button>
    </>} />;
}
