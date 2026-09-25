import { useCallback, useEffect, useRef, useState } from "react";
import { getBackend } from "@/ipc/client";
import type { Parts, RestoreProgress } from "@/ipc/types";

const IDLE: RestoreProgress = { running: false, phase: "", doneBytes: 0, totalBytes: 0, currentItem: null, error: null, path: null, parts: null };

function same(a: RestoreProgress, b: RestoreProgress): boolean {
  return a.running === b.running && a.phase === b.phase && a.doneBytes === b.doneBytes && a.totalBytes === b.totalBytes
    && a.currentItem === b.currentItem && a.error === b.error && a.path === b.path;
}

/**
 * The backend owns the restore; this follows it, twice a second while it
 * runs. `onFinished` hears how it ended.
 */
export function useRestoreJob(onFinished: (progress: RestoreProgress) => void) {
  const [progress, setProgress] = useState(IDLE);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef(true);
  const follow = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const next = await (await getBackend()).restoreProgress();
      if (!live.current) return;
      setProgress(current => {
        if (current.running && !next.running) queueMicrotask(() => finished.current(next));
        return same(current, next) ? current : next;
      });
      if (next.running) timer.current = setTimeout(() => void follow(), 500);
    } catch {
      if (live.current) timer.current = setTimeout(() => void follow(), 1000);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void follow();
    return () => { live.current = false; clearTimeout(timer.current); };
  }, [follow]);
  const start = useCallback(async (path: string, parts: Parts) => {
    await (await getBackend()).startRestore(path, parts);
    setProgress({ ...IDLE, running: true, phase: "preparing", path, parts });
    void follow();
  }, [follow]);
  const stop = useCallback(async () => {
    await (await getBackend()).cancelRestore();
    void follow();
  }, [follow]);
  return { progress, start, stop };
}
