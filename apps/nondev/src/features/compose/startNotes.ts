// A one-line note about how a conversation was started, shown at the top of
// the conversation until the thread has its private copy (or forever, when it
// never got one). In memory only: the hash router never reloads the page, and
// the Versions rail repeats the gist for anyone who opens the thread later.
import type { ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

const notes = new Map<ThreadId, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rememberStartNote(threadId: ThreadId, note: string): void {
  notes.set(threadId, note);
  for (const listener of listeners) listener();
}

export function useStartNote(threadId: ThreadId): string | null {
  return useSyncExternalStore(
    subscribe,
    () => notes.get(threadId) ?? null,
    () => null,
  );
}
