// A grown-up using the shared family Mac: picked on "Who's using SKYCOT?" and proven with the
// parent code, which opens the engine's grown-up grant on this device. While that grant lasts this
// window shows the grown-up view of SKYCOT (not the child view); when it lapses, or on Switch, the
// picker comes back. The engine stays the authority: every grown-up action still checks the grant.
import { useSyncExternalStore } from "react";

import { grownUpSettingsOpen, type FamilyView } from "./family";

const KEY = "skycot:family:grown-up";
const CHILD_KEY = "skycot:family:grown-up-return-child";
const listeners = new Set<() => void>();

/** The grown-up marked on this window (read outside React; still check the grant). */
export function readGrownUpSessionId(): string | null {
  return read();
}

function read(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

/** Marks this window as a grown-up's (after the parent code opened the grant). */
export function startGrownUpSession(personId: string, childId: string | null = null) {
  try {
    window.sessionStorage.setItem(KEY, personId);
    if (childId !== null) window.sessionStorage.setItem(CHILD_KEY, childId);
  } catch {
    // Blocked storage: the window simply stays in the child view.
  }
  notify();
}

/** Child who was using this window before a grown-up took over. */
export function grownUpReturnChild(): string | null {
  try {
    return window.sessionStorage.getItem(CHILD_KEY);
  } catch {
    return null;
  }
}

export function clearGrownUpReturnChild() {
  try {
    window.sessionStorage.removeItem(CHILD_KEY);
  } catch {
    // Nothing stored.
  }
}

export function endGrownUpSession() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
  notify();
}

/** The grown-up using this window, while their grant is still open; null otherwise. */
export function grownUpSessionFor(
  personId: string | null,
  view: Pick<FamilyView, "openUntil" | "grownUps">,
  now: number,
): string | null {
  if (personId === null || !grownUpSettingsOpen(view, now)) return null;
  return view.grownUps.some((person) => person.id === personId) ? personId : null;
}

export function useGrownUpSessionId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => null,
  );
}
