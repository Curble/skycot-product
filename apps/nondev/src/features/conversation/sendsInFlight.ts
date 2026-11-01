// Which conversations have a message on its way to the engine right now. A "Build it" is tied
// to one plan; if another message is still being sent, the engine could put the two in the
// other order, and the build would then run after a newer plan was written. So a Build it waits
// for the send to finish (its button is off) and is never sent while one is in flight. This
// only reads and refuses; it grants nothing.
import { useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/** Marks one send as started for the thread; call the returned function when it has finished. */
export function beginSend(threadId: string): () => void {
  counts.set(threadId, (counts.get(threadId) ?? 0) + 1);
  changed();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const left = (counts.get(threadId) ?? 1) - 1;
    if (left <= 0) counts.delete(threadId);
    else counts.set(threadId, left);
    changed();
  };
}

export function sendInFlight(threadId: string): boolean {
  return (counts.get(threadId) ?? 0) > 0;
}

/** Re-renders while a send for the thread is in flight. */
export function useSendInFlight(threadId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => sendInFlight(threadId),
    () => false,
  );
}

/**
 * Runs one send with its in-flight mark switched on in the same tick it is called (before any
 * await), and always switched off afterwards. The composer wraps its whole send path in this, so
 * a Build it pressed in the very same instant, even while the words are still being checked,
 * already sees the other message.
 */
export async function whileSending<T>(threadId: string, run: () => Promise<T>): Promise<T> {
  const endSend = beginSend(threadId);
  try {
    return await run();
  } finally {
    endSend();
  }
}

/** Why a Build it is held back right now: another message of the person's, or Sam still working. */
export type BuildItHold = "other-message" | "assistant-busy";

export function buildItHold(threadId: string, assistantBusy: boolean): BuildItHold | null {
  if (sendInFlight(threadId)) return "other-message";
  return assistantBusy ? "assistant-busy" : null;
}

/** What a child reads when a Build it is held back: calm, and says what to do next. */
export function buildItHeldBackNote(hold: BuildItHold, builderName: string): string {
  return hold === "other-message"
    ? "Your other message is still going. When it finishes, press Build it on the newest plan."
    : `${builderName} is still finishing. When ${builderName} is done, press Build it on the newest plan.`;
}
