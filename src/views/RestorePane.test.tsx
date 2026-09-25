// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Backend, Status } from "@/ipc/types";
import { createMockBackend } from "@/ipc/mock";
import { RestorePane, blockedReason } from "./RestorePane";

const held = vi.hoisted(() => ({ backend: null as unknown as Backend }));
vi.mock("@/ipc/client", () => ({ getBackend: () => Promise.resolve(held.backend) }));

let host: HTMLDivElement;
let root: Root;
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent === name);
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(3000); });

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom lays nothing out, so it has no scrolling.
  Element.prototype.scrollIntoView = vi.fn();
  held.backend = createMockBackend();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("says what stands in the way of a restore, most important first", () => {
  const ready: Status = { library: "/l/master.db", libraryError: null, rekordboxRunning: false, rbxportRunning: false, analysisEditPending: false, restorePending: false };
  expect(blockedReason(ready, false)).toBe("");
  expect(blockedReason(null, false)).toMatch(/^Checking/);
  expect(blockedReason(ready, true)).toBe("A restore is running.");
  expect(blockedReason({ ...ready, rbxportRunning: true, rekordboxRunning: true }, false)).toBe("Quit rekordbox before restoring a backup.");
  expect(blockedReason({ ...ready, rbxportRunning: true }, false)).toBe("Quit RBXport before restoring a backup.");
  expect(blockedReason({ ...ready, restorePending: true, rekordboxRunning: true }, false)).toBe("Finish the interrupted restore first.");
});

it("opens a backup to show what it holds beside the library now", async () => {
  await act(async () => { root.render(<RestorePane />); });
  await settle();
  const rows = host.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(4);
  await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click(); });
  await settle();
  const details = host.querySelector("[aria-label='What this backup holds']");
  expect(details?.textContent).toContain("Hot cues");
  expect(details?.textContent).toContain("168,615");
  expect(host.querySelector("figure[aria-label='Backup contents']")).not.toBeNull();
});

it("restores only the parts left ticked", async () => {
  const start = vi.spyOn(held.backend, "startRestore");
  await act(async () => { root.render(<RestorePane />); });
  await settle();
  await act(async () => { button("Restore…")?.click(); });
  await settle();
  const analysis = host.querySelector<HTMLInputElement>("input[aria-label='Analysis files']");
  await act(async () => { analysis?.click(); });
  expect(host.textContent).toContain("Analysis files stay as they are now");
  await act(async () => { button("Restore selected…")?.click(); });
  await settle();
  expect(start).toHaveBeenCalledWith(expect.stringMatching(/rbexport-20260923-2210\.zip$/), { database: true, analysis: false, artwork: true, libraryFiles: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(host.textContent).toContain("Backup restored.");
});

it("will not restore a backup of another library", async () => {
  await act(async () => { root.render(<RestorePane />); });
  await settle();
  const expanders = host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]");
  await act(async () => { expanders[3]?.click(); });
  await settle();
  expect(host.textContent).toContain("This backup belongs to another rekordbox library.");
  expect(button("Restore selected…")?.disabled).toBe(true);
});
