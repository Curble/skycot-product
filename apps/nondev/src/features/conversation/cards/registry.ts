// The timeline's extension point, kept apart from Timeline.tsx so the card
// modules can register themselves without an import cycle through the stream.
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";

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
