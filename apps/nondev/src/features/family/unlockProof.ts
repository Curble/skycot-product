// The grown-up proof for this window, kept in memory only (never stored on disk). The engine also
// sets it as an HttpOnly cookie, but the Mac app's page (skycot://app) is not the engine's origin,
// so the cookie never comes back; this copy travels as a header instead.
let proof: string | null = null;

export function keepUnlockProof(token: string | null | undefined) {
  if (typeof token === "string" && token.length > 0) proof = token;
}

export function readUnlockProof(): string | null {
  return proof;
}

export function forgetUnlockProof() {
  proof = null;
  clearUnlockProofHandoff(windowStorage());
}

// One-shot hand-over across SKYCOT's own intentional restart (the window reload that gives a
// grown-up a clean cache). The reload drops the in-memory copy, so it is parked in this window's
// sessionStorage for exactly one boot: the booting page takes it and deletes it at once.
export const UNLOCK_HANDOFF_KEY = "skycot:family:unlock-handoff";

type SlotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function windowStorage(): SlotStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Parks the proof for the next boot. Returns true when something was written. */
export function handoffUnlockProof(storage: SlotStorage | null = windowStorage()): boolean {
  if (storage === null || proof === null) return false;
  try {
    storage.setItem(UNLOCK_HANDOFF_KEY, proof);
    return true;
  } catch {
    return false;
  }
}

/** Boot: reads the parked proof once and deletes it. Null when none was parked. */
export function takeUnlockProofHandoff(
  storage: SlotStorage | null = windowStorage(),
): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(UNLOCK_HANDOFF_KEY);
    storage.removeItem(UNLOCK_HANDOFF_KEY);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearUnlockProofHandoff(storage: SlotStorage | null = windowStorage()) {
  try {
    storage?.removeItem(UNLOCK_HANDOFF_KEY);
  } catch {
    // Nothing stored.
  }
}

/** First thing on boot: restore the parked proof only if this window is still marked a grown-up's. */
export function restoreUnlockProofOnBoot(
  grownUpMark: string | null,
  storage: SlotStorage | null = windowStorage(),
) {
  const parked = takeUnlockProofHandoff(storage);
  if (grownUpMark !== null) keepUnlockProof(parked);
}
