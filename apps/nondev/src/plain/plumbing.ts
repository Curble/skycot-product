// The assistant's own behind-the-scenes work, which a child never needs to see: Claude Code's
// plan-mode notes in its own folder (~/.claude/plans/…, outside the project and never the
// child's work) and its tool look-ups (ToolSearch "select:ExitPlanMode", the plan-mode switch).
// Live, 25 October 2026: a child saw "Edited the skycot family rules…" while Sam only planned,
// and the Build Journey jumped to "Build it".
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

const PROVIDER_PLAN_FILE = /(?:^|\/)\.claude\/plans\/[^/]+\.md$/;
const PLUMBING_TOOLS = new Set(["ToolSearch", "ExitPlanMode", "EnterPlanMode"]);

/** True for an item that is the assistant's own housekeeping, not part of the child's make. */
export function isAssistantPlumbing(item: OrchestrationV2TurnItem): boolean {
  if (item.type === "file_change") return PROVIDER_PLAN_FILE.test(item.fileName);
  if (item.type === "dynamic_tool") {
    if (item.toolName !== null && PLUMBING_TOOLS.has(item.toolName)) return true;
    const query = (item.input as { readonly query?: unknown } | null)?.query;
    if (typeof query === "string" && query.startsWith("select:")) return true;
    const plan = (item.input as { readonly plan?: unknown } | null)?.plan;
    // ExitPlanMode's own call (its plan shows as the plan card instead).
    return typeof plan === "string" && item.toolName === null;
  }
  return false;
}

export function withoutAssistantPlumbing(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<OrchestrationV2TurnItem> {
  return items.some(isAssistantPlumbing)
    ? items.filter((item) => !isAssistantPlumbing(item))
    : items;
}
