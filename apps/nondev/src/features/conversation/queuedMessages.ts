// A message lined up behind the assistant's work. The engine records it as a message plus a run
// that has not started ("queued"), and only writes its row in the conversation once that run
// begins. Without this, the person's bubble sat on "Sending…" for the whole wait and "Take back"
// could not appear. This adds the row the screen would show anyway; it changes nothing in the
// engine and grants nothing: Take back still only cancels that one lined-up run.
import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  TurnItemId,
} from "@t3tools/contracts";

export type QueuedMessageSource = Pick<
  OrchestrationV2ThreadProjection,
  "turnItems" | "runs" | "messages"
>;

/**
 * The conversation's rows with a row added at the end for each person's message that is lined up
 * (its run is "queued") and not yet written as a row. The input is returned as-is when there is
 * nothing to add.
 */
export function withQueuedMessageItems(
  projection: QueuedMessageSource,
): ReadonlyArray<OrchestrationV2TurnItem> {
  const recorded = new Set(
    projection.turnItems.flatMap((item) => (item.type === "user_message" ? [item.messageId] : [])),
  );
  const added: OrchestrationV2TurnItem[] = [];
  let ordinal = projection.turnItems.reduce((top, item) => Math.max(top, item.ordinal), 0);
  const queued = projection.runs
    .filter((run) => run.status === "queued" && run.userMessageId !== null)
    .toSorted((a, b) => (a.queuePosition ?? a.ordinal) - (b.queuePosition ?? b.ordinal));
  for (const run of queued) {
    const message = projection.messages.find(
      (candidate) => candidate.id === run.userMessageId && candidate.role === "user",
    );
    if (message === undefined || recorded.has(message.id)) continue;
    recorded.add(message.id);
    ordinal += 1;
    added.push({
      id: `queued:${message.id}` as TurnItemId,
      threadId: message.threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      providerThreadId: run.providerThreadId,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status: "completed",
      title: null,
      startedAt: message.createdAt,
      completedAt: message.createdAt,
      updatedAt: message.updatedAt,
      type: "user_message",
      createdBy: message.createdBy,
      creationSource: message.creationSource,
      messageId: message.id,
      ...(message.workflowScript === undefined ? {} : { workflowScript: message.workflowScript }),
      inputIntent: "queued_turn",
      text: message.text,
      ...(message.context ? { context: message.context } : {}),
      attachments: message.attachments,
    } as OrchestrationV2TurnItem);
  }
  return added.length === 0 ? projection.turnItems : [...projection.turnItems, ...added];
}
