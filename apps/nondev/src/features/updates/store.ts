// The Mac app's updater, as one shared value for every screen in this window (About, the
// title-bar pill, the restart sheet). In a browser there is no desktop bridge and the value
// stays null. A new version is downloaded as soon as SKYCOT finds it: downloading changes
// nothing until the restart, which is the one step that asks (and, with the Family profile on,
// needs the parent code).
import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

type Updater = Pick<
  DesktopBridge,
  "getUpdateState" | "onUpdateState" | "checkForUpdate" | "downloadUpdate" | "installUpdate"
>;

/**
 * The Mac app's updater. Dev builds only: a stand-in at `window.__skycotFakeUpdater` lets the
 * update screens be shown and tested in a browser without a packaged app (the whole branch is
 * dropped from production builds).
 */
function updater(): Updater | undefined {
  if (typeof window === "undefined") return undefined;
  if (import.meta.env.DEV) {
    const fake = (window as { __skycotFakeUpdater?: Updater }).__skycotFakeUpdater;
    if (fake) return fake;
  }
  return window.desktopBridge;
}

let current: DesktopUpdateState | null = null;
let started = false;
const listeners = new Set<() => void>();
/** Versions this window already asked the Mac app to download, so a retry stays a choice. */
const downloadsAsked = new Set<string>();

function publish(state: DesktopUpdateState) {
  current = state;
  for (const listener of listeners) listener();
  const version = state.availableVersion;
  if (state.enabled && state.status === "available" && version && !downloadsAsked.has(version)) {
    downloadsAsked.add(version);
    void updater()
      ?.downloadUpdate()
      .catch(() => undefined);
  }
}

function start() {
  if (started) return;
  const bridge = updater();
  if (!bridge?.getUpdateState || !bridge.onUpdateState) return;
  started = true;
  bridge.onUpdateState(publish);
  void bridge.getUpdateState().then(publish, () => undefined);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Mac app's update state, or null in a browser (or before the first answer). */
export function useDesktopUpdateState(): DesktopUpdateState | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

export const hasDesktopUpdater = () => typeof updater()?.getUpdateState === "function";

export async function checkForUpdate(): Promise<void> {
  const result = await updater()
    ?.checkForUpdate()
    .catch(() => null);
  if (result) publish(result.state);
}

export async function retryDownload(): Promise<void> {
  const result = await updater()
    ?.downloadUpdate()
    .catch(() => null);
  if (result) publish(result.state);
}

/** Asks the Mac app to restart into the downloaded version; false when it said no. */
export async function installDownloadedUpdate(): Promise<boolean> {
  const result = await updater()
    ?.installUpdate()
    .catch(() => null);
  if (!result) return false;
  publish(result.state);
  return result.accepted;
}
