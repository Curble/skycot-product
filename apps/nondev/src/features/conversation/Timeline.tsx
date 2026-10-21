// The conversation stream and its extension point.
//
// Later agents plug rich cards (Plan, Working, Approval, What changed, …) in by
// calling `registerTimelineRenderer("<turn item type>", renderer)` from their
// own module; the switch below is only the fallback for anything unregistered.
// A renderer receives the item plus the whole projection and returns a node
// (usually a <Bubble author="crew" full>…card…</Bubble>) or null to hide it.
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";

import { describeTurnItem } from "../../plain/narration";
import { Bubble, DayDivider, TypingIndicator } from "../../ui/Bubble";
import { formatDayDivider } from "./status";

export type TimelineItemType = OrchestrationV2TurnItem["type"];

export interface TimelineRenderContext {
  readonly item: OrchestrationV2TurnItem;
  readonly index: number;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly projectName: string | null;
}

export type TimelineItemRenderer = (context: TimelineRenderContext) => ReactNode;

const renderers = new Map<TimelineItemType, TimelineItemRenderer>();

/** Register (or replace) the renderer for one turn-item type. Returns an unregister function. */
export function registerTimelineRenderer(
  type: TimelineItemType,
  renderer: TimelineItemRenderer,
): () => void {
  renderers.set(type, renderer);
  return () => {
    if (renderers.get(type) === renderer) renderers.delete(type);
  };
}

export function getTimelineRenderer(type: TimelineItemType): TimelineItemRenderer | undefined {
  return renderers.get(type);
}

/** Items the default stream never shows on their own; registered renderers can still claim them. */
const HIDDEN_BY_DEFAULT: ReadonlySet<TimelineItemType> = new Set<TimelineItemType>([
  "thread_created",
  "checkpoint",
  "compaction",
]);

function narrationContext(context: TimelineRenderContext) {
  return context.projectName === null ? {} : { projectName: context.projectName };
}

function renderDefault(context: TimelineRenderContext): ReactNode {
  const { item } = context;
  switch (item.type) {
    case "user_message":
      return <Bubble author="me">{item.text}</Bubble>;
    case "assistant_message":
      if (item.text.trim().length === 0) return item.streaming ? <TypingIndicator /> : null;
      return (
        <Bubble author="crew" meta={item.streaming ? "Crew is typing…" : undefined}>
          {item.text}
        </Bubble>
      );
    case "reasoning": {
      const narration = describeTurnItem(item, narrationContext(context));
      return (
        <Bubble author="crew" muted>
          {narration.headline}
        </Bubble>
      );
    }
    default: {
      if (HIDDEN_BY_DEFAULT.has(item.type)) return null;
      const narration = describeTurnItem(item, narrationContext(context));
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
  const custom = renderers.get(context.item.type);
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
  return (
    <div className="fm-stream" role="log" aria-live="polite" aria-label="Conversation">
      <div className="fm-stream__inner">
        {startedAt ? <DayDivider>{formatDayDivider(startedAt)}</DayDivider> : null}
        {items.map((item, index) => {
          const node = renderTimelineItem({
            item,
            index,
            items,
            projection,
            environmentId,
            threadId,
            shell,
            projectName,
          });
          return node === null || node === undefined ? null : (
            <div key={item.id} className="fm-stream__item">
              {node}
            </div>
          );
        })}
        {trailing}
      </div>
    </div>
  );
}
