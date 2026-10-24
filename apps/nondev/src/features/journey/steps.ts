import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

export const JOURNEY_STEPS = [
  "Think it through",
  "Make a plan",
  "Build it",
  "Test it",
  "Finish",
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
export interface JourneyState {
  readonly steps: ReadonlyArray<{
    readonly label: JourneyStep;
    readonly state: "done" | "now" | "next";
  }>;
  readonly now: JourneyStep;
  readonly facts: ReadonlyArray<string>;
}

/** Maps persisted turn items to the five child-facing milestones. */
export function journeyFromItems(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  childName = "Sam",
  finished = false,
): JourneyState {
  const hasPlan = items.some((item) => item.type === "proposed_plan" || item.type === "todo_list");
  const fileChanges = items.filter((item) => item.type === "file_change");
  const commands = items.filter((item) => item.type === "command_execution");
  const now: JourneyStep = finished
    ? "Finish"
    : commands.length
      ? "Test it"
      : fileChanges.length
        ? "Build it"
        : hasPlan
          ? "Make a plan"
          : "Think it through";
  const currentIndex = JOURNEY_STEPS.indexOf(now);
  const facts = [
    ...items
      .filter((item) => item.type === "todo_list")
      .flatMap((item) =>
        item.type === "todo_list" ? [`${childName} made ${item.steps.length} steps`] : [],
      ),
    ...(fileChanges.length
      ? [
          `${childName} wrote ${new Set(fileChanges.map((item) => (item.type === "file_change" ? item.fileName : ""))).size} ${new Set(fileChanges.map((item) => (item.type === "file_change" ? item.fileName : ""))).size === 1 ? "page" : "pages"}${fileChanges.some((item) => item.type === "file_change" && item.additions !== undefined) ? ` with ${fileChanges.reduce((n, item) => n + (item.type === "file_change" ? (item.additions ?? 0) : 0), 0)} lines` : ""}`,
        ]
      : []),
    ...(commands.length
      ? [
          `${childName} checked the work ${commands.length} ${commands.length === 1 ? "time" : "times"}`,
        ]
      : []),
  ];
  return {
    now,
    facts,
    steps: JOURNEY_STEPS.map((label, index) => ({
      label,
      state:
        index < currentIndex || (finished && label !== "Finish")
          ? "done"
          : index === currentIndex
            ? "now"
            : "next",
    })),
  };
}
