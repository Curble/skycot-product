// Folds a run's tool activity into one "Working on it" card. Everything the
// agent does with its hands (edits, commands, searches, thinking, side tasks,
// its own to-do list) belongs to the run it happened in; what it says, asks or
// proposes stays a message of its own in the stream.
import type { OrchestrationV2TurnItem, RunId } from "@t3tools/contracts";

import type { TimelineItemType } from "./registry";

export const WORK_ITEM_TYPES: ReadonlySet<TimelineItemType> = new Set<TimelineItemType>([
  "file_change",
  "command_execution",
  "file_search",
  "web_search",
  "reasoning",
  "dynamic_tool",
  "subagent",
  "todo_list",
]);

export interface WorkGroup {
  readonly kind: "work";
  /** Stable key for React; the run id when known, else the first item's id. */
  readonly key: string;
  readonly runId: RunId | null;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  /** Position of the newest grouped item in the full list: the card sits after the asks it made. */
  readonly index: number;
}

export interface SingleEntry {
  readonly kind: "item";
  readonly item: OrchestrationV2TurnItem;
  readonly index: number;
}

export type TimelineEntry = WorkGroup | SingleEntry;

interface MutableWorkGroup {
  kind: "work";
  key: string;
  runId: RunId | null;
  items: Array<OrchestrationV2TurnItem>;
  index: number;
}

/**
 * One card per run, placed where the run's newest tool item sits, so a
 * finished "Done" never reads above the approval cards that led to it. Items
 * without a run id (older servers) group by adjacency instead.
 */
export function groupTimelineItems(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<TimelineEntry> {
  const entries: Array<TimelineEntry | MutableWorkGroup> = [];
  const byRun = new Map<RunId, MutableWorkGroup>();
  let adjacent: MutableWorkGroup | null = null;
  items.forEach((item, index) => {
    if (!WORK_ITEM_TYPES.has(item.type)) {
      adjacent = null;
      entries.push({ kind: "item", item, index });
      return;
    }
    if (item.runId !== null) {
      adjacent = null;
      const existing = byRun.get(item.runId);
      if (existing) {
        existing.items.push(item);
        existing.index = index;
        const at = entries.indexOf(existing);
        if (at !== -1 && at !== entries.length - 1) {
          entries.splice(at, 1);
          entries.push(existing);
        }
        return;
      }
      const group: MutableWorkGroup = {
        kind: "work",
        key: `run:${item.runId}`,
        runId: item.runId,
        items: [item],
        index,
      };
      byRun.set(item.runId, group);
      entries.push(group);
      return;
    }
    if (adjacent) {
      adjacent.items.push(item);
      return;
    }
    adjacent = { kind: "work", key: `item:${item.id}`, runId: null, items: [item], index };
    entries.push(adjacent);
  });
  return entries;
}
