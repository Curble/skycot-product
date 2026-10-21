// The conversation stream and its extension point.
//
// Rich cards plug in by calling `registerTimelineRenderer("<turn item type>",
// renderer)` (see cards/registry.ts; cards/index.tsx registers ours). The
// stream first folds each run's tool activity into one WorkingCard
// (cards/grouping.ts), then hands every remaining item to its renderer, falling
// back to a quiet narrated line for anything unregistered.
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";

import { describeTurnItem } from "../../plain/narration";
import { Bubble, DayDivider, TypingIndicator } from "../../ui/Bubble";
import { groupTimelineItems } from "./cards";
import {
  getTimelineRenderer,
  type TimelineItemType,
  type TimelineRenderContext,
} from "./cards/registry";
import { formatDayDivider } from "./status";
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
]);

function renderDefault(context: TimelineRenderContext): ReactNode {
  const { item } = context;
  switch (item.type) {
    case "user_message":
      return <Bubble author="me">{item.text}</Bubble>;
    case "assistant_message":
      if (item.text.trim().length === 0) return item.streaming ? <TypingIndicator /> : null;
      return <Bubble author="crew">{item.text}</Bubble>;
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
  const entries = groupTimelineItems(items);
  return (
    <div className="fm-stream" role="log" aria-live="polite" aria-label="Conversation">
      <div className="fm-stream__inner">
        {startedAt ? <DayDivider>{formatDayDivider(startedAt)}</DayDivider> : null}
        {entries.map((entry) => {
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
          return node === null || node === undefined ? null : (
            <div key={entry.item.id} className="fm-stream__item">
              {node}
            </div>
          );
        })}
        {trailing}
      </div>
    </div>
  );
}
