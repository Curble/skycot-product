// A fresh start for the shared Mac when the picker moves to another child: the client keeps
// conversations and projects in the browser's own store (T3's connection runtime cache), and
// those belong to the child who was using SKYCOT before. The switch marks a fresh start and
// reloads; at boot the mark is read once and the cached engine data is deleted before anything
// renders, so nothing of the previous child's is ever shown to the next one.
const FRESH_START_KEY = "skycot:fresh-start";
/** T3's cache database (apps/web/src/connection/storage.ts DATABASE_NAME). */
export const ENGINE_CACHE_DATABASE = "t3code:connection-runtime";

export function markFreshStart(storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(FRESH_START_KEY, "1");
  } catch {
    // Private windows may refuse; the reload still re-fetches everything live.
  }
}

/** Pure: whether the mark says to clear, and the mark is spent by reading it. */
export function takeFreshStart(
  storage: Pick<Storage, "getItem" | "removeItem"> = localStorage,
): boolean {
  try {
    const marked = storage.getItem(FRESH_START_KEY) === "1";
    if (marked) storage.removeItem(FRESH_START_KEY);
    return marked;
  } catch {
    return false;
  }
}

/** Deletes the cached engine data when a fresh start was marked; never throws, never hangs. */
export function clearCachedEngineData(
  deleteDatabase: (name: string) => IDBOpenDBRequest | null = (name) =>
    typeof indexedDB === "undefined" ? null : indexedDB.deleteDatabase(name),
  storage?: Pick<Storage, "getItem" | "removeItem">,
): Promise<void> {
  if (!takeFreshStart(storage)) return Promise.resolve();
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest | null = null;
    try {
      request = deleteDatabase(ENGINE_CACHE_DATABASE);
    } catch {
      request = null;
    }
    if (request === null) {
      resolve();
      return;
    }
    const done = () => resolve();
    request.onsuccess = done;
    request.onerror = done;
    request.onblocked = done;
    // Whatever happens, the app starts within two seconds.
    setTimeout(done, 2000);
  });
}

// The engine's live lists are filtered per viewer when the subscription starts, so a window that
// has shown a grown-up's everything holds more than any child may see (and one that showed a
// child holds less than a grown-up should). The first time a grown-up's turn opens the window
// restarts fresh; when the child comes back the next pick restarts it again, even for the same
// child. The mark lives for the tab, so it survives those reloads.
const GROWN_UP_SEEN_KEY = "skycot:grown-up-cache";

export function markGrownUpSeen(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(GROWN_UP_SEEN_KEY, "1");
  } catch {
    // Blocked storage: the child switch still restarts when the child changed.
  }
}

export function grownUpSeen(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(GROWN_UP_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearGrownUpSeen(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(GROWN_UP_SEEN_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Pure: whether picking a child restarts the window fresh. */
export function pickRestartsFresh(
  before: string | null,
  chosen: string,
  grownUpHadTurn: boolean,
): boolean {
  return grownUpHadTurn || (before !== null && before !== chosen);
}

/**
 * Pure: whether a grown-up's turn opening restarts the window now. Never during first-run
 * set-up: the parent code opens their turn in the middle of the welcome steps, and a restart
 * there throws the sheet away (the profile is on by the time the window is back, so the steps
 * never reopen). The set-up window loaded before any child existed, so its lists hold
 * everything already; the mark stays unset so the next grown-up turn still restarts.
 */
export function grownUpTurnRestarts(grownUp: boolean, seen: boolean, setupOpen: boolean): boolean {
  return grownUp && !seen && !setupOpen;
}
