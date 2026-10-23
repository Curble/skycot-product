// Watches the open conversation for sticker moments: a message this device just sent, and
// SKYCOT finishing a turn that changed files. Only a cheap key is computed while the
// conversation streams; the facts are worked out when that key changes (a new message, a new
// "What changed" card), and each is reported once (store.ts and the engine both de-duplicate).
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";

import { conversationTitle } from "../conversation/status";
import { latestReviewable } from "../review";
import { conversationEvents } from "./facts";
import { reportBadgeEvent } from "./store";

export function useBadgeWatcher({
  threadId,
  shell,
  projection,
  active,
  retryMade = null,
}: {
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  /** A turn is running: "made" waits for it to finish. */
  readonly active: boolean;
  /** A retry after a failed turn that made something (review/useRetryMade). */
  readonly retryMade?: string | null;
}) {
  let lastMessage: string | null = null;
  let messages = 0;
  for (const item of projection?.turnItems ?? []) {
    if (item.type === "user_message") {
      messages += 1;
      lastMessage = item.messageId;
    }
  }
  const made =
    projection !== null && !active ? (retryMade ?? latestReviewable(projection)?.id ?? null) : null;
  // Waits for the shell too: a key spent before the shell arrived would report nothing.
  const key =
    projection === null || shell === null ? null : `${threadId}:${messages}:${lastMessage}:${made}`;

  const report = useEffectEvent(() => {
    if (projection === null || shell === null) return;
    const events = conversationEvents({
      projection,
      threadId,
      title: conversationTitle(shell),
      madeSomething: made !== null,
      now: Date.now(),
    });
    for (const event of events) void reportBadgeEvent(event, shell.projectId ?? null);
  });

  useEffect(() => {
    if (key !== null) report();
  }, [key]);
}
