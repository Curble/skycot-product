import { describe, expect, it } from "vite-plus/test";

import { planFlagKey, withRealPlanFlag } from "./conversations";

const shell = (runId: string | null, flag = true) =>
  ({
    id: "thread-1",
    latestRun: runId === null ? null : { runId },
    hasActionableProposedPlan: flag,
  }) as never;

describe("the list row's plan flag", () => {
  it("is cleared once the conversation found no plan really waiting at this run", () => {
    const found = new Set([planFlagKey(shell("run-2"))]);
    expect(withRealPlanFlag(shell("run-2"), found).hasActionableProposedPlan).toBe(false);
  });
  it("is read afresh at a later run, and when nothing was found", () => {
    const found = new Set([planFlagKey(shell("run-2"))]);
    expect(withRealPlanFlag(shell("run-3"), found).hasActionableProposedPlan).toBe(true);
    expect(withRealPlanFlag(shell("run-2"), new Set()).hasActionableProposedPlan).toBe(true);
  });
  it("never raises a flag the engine did not", () => {
    expect(withRealPlanFlag(shell("run-2", false), new Set()).hasActionableProposedPlan).toBe(
      false,
    );
  });
});
