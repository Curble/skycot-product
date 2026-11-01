import { describe, expect, it } from "vite-plus/test";

import { builtBy, planWaitingForBuild, replacedByNewerPlan } from "./plans";

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

describe("a build that began after a plan was written built it", () => {
  const early = { ...earlier, completedAt: "2026-11-02T01:00:00.000Z" };
  const late = { ...newer, completedAt: "2026-11-02T01:00:10.000Z" };
  const race = (startedAt: string | null, status = "running") => ({
    turnItems: [early, late],
    plans: [plan("one", "active", "r1"), plan("two", "active", "r2")],
    runs: [
      { id: "r1", status: "completed" },
      { id: "r2", status: "completed" },
      { id: "r3", status, startedAt, sourcePlanRef: { planId: "one" } },
    ],
  });
  it("Build it on the older plan as a newer one arrives: the newer plan never waits", () => {
    expect(planWaitingForBuild(race("2026-11-02T01:00:20.000Z"))).toBe(false);
  });
  it("a build that began before the newer plan was written does not build it", () => {
    expect(planWaitingForBuild(race("2026-11-02T01:00:05.000Z"))).toBe(true);
  });
  it("a build that has not started, or was taken back, builds nothing yet", () => {
    expect(planWaitingForBuild(race(null, "queued"))).toBe(true);
    expect(planWaitingForBuild(race("2026-11-02T01:00:20.000Z", "rolled_back"))).toBe(true);
  });
  it("builtBy names the build run, or none", () => {
    const runs = [
      {
        id: "b",
        status: "running",
        startedAt: "2026-11-02T01:00:20.000Z",
        sourcePlanRef: { planId: "one" },
      },
    ];
    expect(builtBy({ planId: "two", writtenAt: "2026-11-02T01:00:10.000Z" }, runs)?.id).toBe("b");
    expect(builtBy({ planId: "two" }, runs)).toBeUndefined();
  });
});
