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

/** What a child reads when a Build it is held back: calm, and says what to do next. */
export const BUILD_IT_HELD_BACK =
  "Your other message is still going. When it finishes, press Build it on the newest plan.";
