// The conversation stream and its extension point.
//
// Rich cards plug in by calling `registerTimelineRenderer("<turn item type>",
// renderer)` (see cards/registry.ts; cards/index.tsx registers ours). The
// stream first folds each run's tool activity into one WorkingCard
// (cards/grouping.ts), then hands every remaining item to its renderer, falling
// back to a quiet narrated line for anything unregistered.
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEffect, useRef, type ReactNode } from "react";

import { readPolicyDecision } from "@t3tools/skycot-rules/decision";

import { describeTurnItem } from "../../plain/narration";
import {
  SWITCH_MESSAGE_PREFIX,
  continuationSwitch,
  isCarriedOnLimitItem,
} from "../../plain/switches";
import { foldTakenBack, rolledBackRunIds } from "../rewind/rewind";
import { TakenBackFold } from "../rewind/TakenBackFold";
import { Bubble, DayDivider, TypingIndicator } from "../../ui/Bubble";
import { groupTimelineItems, type TimelineEntry } from "./cards";
import {
  getTimelineRenderer,
  type TimelineItemType,
  type TimelineRenderContext,
} from "./cards/registry";
import { formatDayDivider } from "./status";
import { SwitchNote, useAssistantSwitches, useEnvironmentProviders } from "./SwitchNote";
import { WorkingCard } from "./WorkingCard";

export {
  getTimelineRenderer,
  registerTimelineRenderer,
  type TimelineItemRenderer,
  type TimelineItemType,
  type TimelineRenderContext,
} from "./cards/registry";

/** Items the default stream never shows on their own; registered renderers can still claim them. */
const HIDDEN_BY_DEFAULT: ReadonlySet<TimelineItemType> = new Set<TimelineItemType>([
  "thread_created",
  "checkpoint",
  "compaction",
  // Stop says so once, on its result line below; the request half is bookkeeping.
  "run_interrupt_request",
]);

function renderDefault(context: TimelineRenderContext): ReactNode {
  const { item } = context;
  switch (item.type) {
    case "user_message":
      return <Bubble author="me">{item.text}</Bubble>;
    case "assistant_message":
      if (item.text.trim().length === 0) return item.streaming ? <TypingIndicator /> : null;
      return <Bubble author="crew">{item.text}</Bubble>;
    case "run_interrupt_result": {
      const askedToStop = context.items.some(
        (other) => other.type === "run_interrupt_request" && other.runId === item.runId,
      );
      return (
        <Bubble author="crew" muted>
          {askedToStop
            ? "You stopped it. Nothing else will run until you reply."
            : "The assistant stopped. Nothing else will run until you reply."}
        </Bubble>
      );
    }
    default: {
      if (HIDDEN_BY_DEFAULT.has(item.type)) return null;
      const narration = describeTurnItem(
        item,
        context.projectName === null ? {} : { projectName: context.projectName },
      );
      return (
        <Bubble author="crew" muted>
          {narration.headline}
          {narration.detail ? ` — ${narration.detail}` : ""}
        </Bubble>
      );
    }
  }
}

export function renderTimelineItem(context: TimelineRenderContext): ReactNode {
  const custom = getTimelineRenderer(context.item.type);
  return custom ? custom(context) : renderDefault(context);
}

export function Timeline({
  environmentId,
  threadId,
  projection,
  shell,
  projectName,
  trailing,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly shell: EnvironmentThreadShell | null;
  readonly projectName: string | null;
  /** Rendered after the last item (e.g. the typing indicator while a run is live). */
  readonly trailing?: ReactNode;
}) {
  const items = projection.turnItems;
  const startedAt = shell?.createdAt ?? null;
  // Asks the SKYCOT rules answered were never a question for the person: they
  // live in the Working card's Show details, not as cards of their own.
  const policyAnswered = new Set(
    projection.runtimeRequests
      .filter((request) => readPolicyDecision(request.answers) !== null)
      .map((request) => request.id),
  );
  // SKYCOT moved a turn to another model while the one in use rested: one plain line instead of
  // the "limit reached" card, and the engine's own "Continue where you left off." stays unseen.
  const switches = useAssistantSwitches(String(threadId), String(projection.runs.length));
  const providers = useEnvironmentProviders(environmentId);
  const entries = groupTimelineItems(items, {
    absorb: (item) =>
      item.type === "approval_request" && item.runId !== null && policyAnswered.has(item.requestId),
  });
  // What a go-back replaced folds into one row once the conversation carried on.
  const folded = foldTakenBack(
    entries.map((entry) => ({
      ...entry,
      runId: entry.kind === "work" ? entry.runId : entry.item.runId,
    })),
    rolledBackRunIds(projection.runs),
  );
  const renderEntry = (entry: TimelineEntry) => {
    if (entry.kind === "work") {
      return (
        <div key={entry.key} className="fm-stream__item">
          <WorkingCard
            group={entry}
            projection={projection}
            environmentId={environmentId}
            threadId={threadId}
            projectName={projectName}
          />
        </div>
      );
    }
    const item = entry.item;
    if (isCarriedOnLimitItem(projection, item)) return null;
    const messageId = item.type === "user_message" ? String(item.messageId) : null;
    const change =
      messageId === null
        ? null
        : (switches.get(messageId) ?? continuationSwitch(projection, providers, messageId));
    const note = change === null ? null : <SwitchNote change={change} providers={providers} />;
    if (messageId !== null && messageId.startsWith(SWITCH_MESSAGE_PREFIX)) {
      return note === null ? null : (
        <div key={item.id} className="fm-stream__item">
          {note}
        </div>
      );
    }
    const node = renderTimelineItem({
      item: entry.item,
      index: entry.index,
      items,
      projection,
      environmentId,
      threadId,
      shell,
      projectName,
    });
    // The wrapper is `display: contents`, so the note sits in the stream as its own line.
    return node === null || node === undefined ? null : (
      <div key={entry.item.id} className="fm-stream__item">
        {node}
        {note}
      </div>
    );
  };
  const stream = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // Follow the newest message like Messages does, but only while the reader is
  // already at the bottom; scrolling up to re-read something pins the view.
  const follow = useRef(true);
  useEffect(() => {
    const scroller = stream.current;
    const content = inner.current;
    if (!scroller || !content) return;
    scroller.scrollTop = scroller.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (follow.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const scroller = stream.current;
    if (!scroller) return;
    follow.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  };
  return (
    <div
      ref={stream}
      className="fm-stream"
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      onScroll={onScroll}
    >
      <div ref={inner} className="fm-stream__inner">
        {startedAt ? <DayDivider>{formatDayDivider(startedAt)}</DayDivider> : null}
        {folded.map((entry) =>
          entry.kind === "taken-back" ? (
            <div key={entry.key} className="fm-stream__item">
              <TakenBackFold
                messages={
                  entry.entries.filter(
                    (part) => part.kind === "item" && part.item.type === "user_message",
                  ).length
                }
              >
                {entry.entries.map(renderEntry)}
              </TakenBackFold>
            </div>
          ) : (
            renderEntry(entry)
          ),
        )}
        {trailing}
      </div>
    </div>
  );
}
