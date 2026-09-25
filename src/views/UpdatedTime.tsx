import { useEffect, useState } from "react";

/** "3 minutes ago", kept current while shown. */
export function UpdatedTime({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 60_000);
    return () => window.clearTimeout(timer);
  }, [now]);
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  const count = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  const label = minutes === 0 ? "just now" : `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  return <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()}>{label}</time>;
}
