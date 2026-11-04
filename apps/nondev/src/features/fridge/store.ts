// The fridge's magnets as this window last heard them from the engine. One copy for the
// sidebar, the Home tile and the fridge itself, refreshed when one of them mounts and after
// every pin; nothing is kept in the browser.
import { useSyncExternalStore } from "react";

import { request } from "../family/api";
import { parseFridge, type FridgeItem } from "./fridge";

interface FridgeSnapshot {
  readonly items: ReadonlyArray<FridgeItem>;
  readonly loaded: boolean;
  readonly problem: string | null;
}

let snapshot: FridgeSnapshot = { items: [], loaded: false, problem: null };
const listeners = new Set<() => void>();
// The sidebar, the Home tile, the fridge and every pin ask at once; the engine's answer depends
// on who is looking, so only the newest question may change what is shown (an older, slower
// answer, perhaps for the child who was looking before, is dropped).
let latest = 0;

function set(next: FridgeSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function useFridge(): FridgeSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    fridgeSnapshot,
    fridgeSnapshot,
  );
}

/** What this window last heard, outside React. */
export function fridgeSnapshot(): FridgeSnapshot {
  return snapshot;
}

export async function refreshFridge(): Promise<void> {
  const asked = ++latest;
  const result = await request("GET", "/fridge", undefined, parseFridge).catch(() => null);
  if (asked !== latest) return;
  set(
    result?.ok
      ? { items: result.value, loaded: true, problem: null }
      : { ...snapshot, loaded: true, problem: "The fridge didn't open just now." },
  );
}

/** "Pin to the fridge" or "Take it down". The page itself is never touched. */
export async function pinMagnet(threadId: string, pinned: boolean): Promise<string | null> {
  // Shown at once; the engine's answer replaces it.
  set({
    ...snapshot,
    items: snapshot.items.map((item) =>
      item.threadId === threadId ? { ...item, pinnedAt: pinned ? Date.now() : null } : item,
    ),
  });
  const asked = ++latest;
  const result = await request("POST", "/fridge/pin", { threadId, pinned }, parseFridge).catch(
    () => null,
  );
  if (result?.ok) {
    if (asked === latest) set({ items: result.value, loaded: true, problem: null });
    return null;
  }
  await refreshFridge();
  return "That didn't work just now.";
}

/** Tests only: forget what this window heard. */
export function resetFridgeForTests(): void {
  latest = 0;
  snapshot = { items: [], loaded: false, problem: null };
}
