import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { BackupSizes } from "@/ipc/types";
import { formatSize } from "@/lib/format";
import { SIZE_PARTS, totalSize } from "@/lib/parts";
import styles from "./RestorePane.module.css";

/** RBXport's Rekordbox Data bar: a stacked bar of sizes by kind and its legend. */
export function SizeChart({ title, label, sizes, loading, loadingText, failed, footer }: {
  title: string;
  /** The figure's accessible name. */
  label: string;
  sizes: BackupSizes | null;
  loading: boolean;
  loadingText: string;
  failed?: ReactNode;
  footer?: ReactNode;
}) {
  const total = sizes ? totalSize(sizes) : 0;
  return <figure className={styles.breakdown} aria-label={label}>
    <figcaption className={styles.breakdownHeading}>
      <strong>{title}</strong>
      {sizes ? <span>{formatSize(total)} total · {sizes.trackCount.toLocaleString()} {sizes.trackCount === 1 ? "track" : "tracks"}</span> : null}
    </figcaption>
    <div className={styles.sizeBarFrame} aria-busy={loading}>
      <div className={styles.sizeBar} role="img" aria-label={!sizes ? `${title} not calculated yet` : total === 0 ? "No data" : SIZE_PARTS.map(part => `${part.label}: ${formatSize(sizes[part.key])}`).join(", ")}>
        {sizes && total > 0 ? SIZE_PARTS.filter(part => sizes[part.key] > 0).map(part => <span key={part.key}
          title={`${part.label}: ${formatSize(sizes[part.key])} (${(sizes[part.key] / total * 100).toFixed(1)}%)`}
          style={{ width: `${sizes[part.key] / total * 100}%`, backgroundColor: part.color }} />) : null}
      </div>
      {loading ? <div className={styles.sizeCalculating} role="status">
        <LoaderCircle size={16} className={styles.sizeSpinner} aria-hidden="true" />
        {loadingText}
      </div> : null}
    </div>
    <ul className={styles.sizeLegend} aria-label={`${title} size breakdown`}>
      {SIZE_PARTS.map(part => <li key={part.key}>
        <span className={styles.sizeDot} style={{ backgroundColor: part.color }} aria-hidden="true" />
        <span>{part.label}</span><span className={styles.sizeValue}>{sizes ? formatSize(sizes[part.key]) : "—"}</span>
      </li>)}
    </ul>
    {failed ? <p className={styles.error} role="alert">{failed}</p> : null}
    {footer ? <div className={styles.sizeFooter}>{footer}</div> : null}
  </figure>;
}
