import { describe, expect, it } from "vite-plus/test";

import { planWaitingForBuild, replacedByNewerPlan } from "./plans";

const earlier = { type: "proposed_plan", id: "one", planId: "one", ordinal: 1 } as const;
const newer = { ...earlier, id: "two", planId: "two", ordinal: 2 };
const plan = (id: string, status: string, runId = "r") => ({
  id,
  kind: "proposed_plan",
  status,
  runId,
});

describe("replacedByNewerPlan", () => {
  it("replaces an earlier plan whatever became of the newer one", () => {
    for (const status of ["active", "completed", "superseded"]) {
      expect(replacedByNewerPlan(earlier, [earlier, newer], [plan("two", status)] as never)).toBe(
        true,
      );
    }
  });
  it("not when the newer plan's turn was taken back, or it is the newest", () => {
    const runs = [{ id: "r", status: "rolled_back" }];
    expect(replacedByNewerPlan(earlier, [earlier, newer], [plan("two", "active")], runs)).toBe(
      false,
    );
    expect(replacedByNewerPlan(newer, [earlier, newer], [plan("one", "active")])).toBe(false);
  });
});

describe("planWaitingForBuild", () => {
  const items = [earlier, newer];
  it("is false once a newer plan was built, even if the old plan stayed active", () => {
    expect(
      planWaitingForBuild({
        turnItems: items,
        plans: [plan("one", "active", "r1"), plan("two", "active", "r2")],
        runs: [
          { id: "r1", status: "completed" },
          { id: "r2", status: "completed" },
          { id: "r3", status: "completed", sourcePlanRef: { planId: "two" } },
        ],
      }),
    ).toBe(false);
  });
  it("is true for the newest plan nobody has built", () => {
    expect(
      planWaitingForBuild({
        turnItems: items,
        plans: [plan("one", "superseded", "r1"), plan("two", "active", "r2")],
        runs: [
          { id: "r1", status: "completed" },
          { id: "r2", status: "completed" },
        ],
      }),
    ).toBe(true);
  });
});
