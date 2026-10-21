// Which threads currently show a pinned "latest turn" review card (the
// ConversationView mounts `ReviewSection` without a checkpointId above the
// stream). The stream's own card for that same turn steps aside so the user
// never sees the decision twice; older turns still get their card in place.
import type { ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

const pinned = new Map<ThreadId, number>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks a thread as having a pinned card; returns the release function. */
export function pinReview(threadId: ThreadId): () => void {
  pinned.set(threadId, (pinned.get(threadId) ?? 0) + 1);
  notify();
  return () => {
    const count = (pinned.get(threadId) ?? 1) - 1;
    if (count <= 0) pinned.delete(threadId);
    else pinned.set(threadId, count);
    notify();
  };
}

export function useHasPinnedReview(threadId: ThreadId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      void version;
      return pinned.has(threadId);
    },
    () => false,
  );
}
