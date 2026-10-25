// The five maker steps of the Build Journey, worked out from what Sam really did in the run
// that is going on now: Think it through and Make a plan while a plan is written (Plan first),
// Build it once files change, Test it for the checks Sam runs after changing them, and Finish.
// Only the current run counts; the plan before a build marks the first two steps done. Looking
// around (listing files, reading) is never "testing".
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

/** Commands that only look around: never a test. */
const LOOKING =
  /^(?:\/bin\/(?:zsh|bash|sh)\s+-l?c\s+['"]?)?\s*(?:ls|pwd|cat|head|tail|find|grep|rg|wc|tree|echo|sed\s+-n|git\s+(?:status|log|diff|show))\b/;

function pageCount(changes: ReadonlyArray<OrchestrationV2TurnItem>): number {
  return new Set(changes.map((item) => (item.type === "file_change" ? item.fileName : ""))).size;
}

/** The run going on now: the latest run any item belongs to. */
function latestRunId(items: ReadonlyArray<OrchestrationV2TurnItem>): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const runId = items[index]!.runId;
    if (runId !== null) return runId;
  }
  return null;
}

/** Maps the conversation's turn items to the five child-facing steps. */
export function journeyFromItems(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  childName = "Sam",
  finished = false,
  runId: string | null = latestRunId(items),
): JourneyState {
  const current = runId === null ? items : items.filter((item) => item.runId === runId);
  const plannedBefore = items.some((item) => item.type === "proposed_plan" && item.runId !== runId);
  const plannedNow = current.some((item) => item.type === "proposed_plan");
  const firstChange = current.findIndex((item) => item.type === "file_change");
  const changes = current.filter((item) => item.type === "file_change");
  const checks = current.filter(
    (item, index) =>
      item.type === "command_execution" &&
      firstChange !== -1 &&
      index > firstChange &&
      !LOOKING.test(item.input.trim()),
  );

  const now: JourneyStep = finished
    ? "Finish"
    : checks.length > 0
      ? "Test it"
      : changes.length > 0 || plannedBefore
        ? "Build it"
        : plannedNow
          ? "Make a plan"
          : "Think it through";
  const currentIndex = JOURNEY_STEPS.indexOf(now);

  const plan = items.findLast((item) => item.type === "proposed_plan");
  const planSteps =
    plan?.type === "proposed_plan"
      ? (plan.markdown.match(/^\s*(?:\d+[.)]|[-*])\s/gm) ?? []).length
      : 0;
  const lines = changes.reduce(
    (total, item) => total + (item.type === "file_change" ? (item.additions ?? 0) : 0),
    0,
  );
  const pages = pageCount(changes);
  const facts = [
    ...(planSteps > 0 ? [`${childName} made ${planSteps} steps`] : []),
    ...(pages > 0
      ? [
          `${childName} wrote ${pages} ${pages === 1 ? "page" : "pages"}${lines > 0 ? ` with ${lines} lines` : ""}`,
        ]
      : []),
    ...(checks.length > 0
      ? [`${childName} checked the work ${checks.length} ${checks.length === 1 ? "time" : "times"}`]
      : []),
  ];
  return {
    now,
    facts,
    steps: JOURNEY_STEPS.map((label, index) => ({
      label,
      state: finished || index < currentIndex ? "done" : index === currentIndex ? "now" : "next",
    })),
  };
}
