// Whether the Versions rail is open at three columns. Remembered per browser;
// storage can be blocked, so reads are guarded and "open" is the default.
import { useSyncExternalStore } from "react";

const KEY = "foreman:versions-rail";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "closed";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setVersionsRailOpen(open: boolean): void {
  try {
    window.localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // The default applies next time.
  }
  for (const listener of listeners) listener();
}

export function useVersionsRailOpen(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

// Sidebar + list + rail is 820px; below this the conversation would be squeezed
// under 460px, so the rail yields to its strip and opens as a sheet instead.
const WIDE = "(min-width: 1280px)";

function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useRoomForRail(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}
