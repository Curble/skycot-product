import { describe, expect, it } from "vite-plus/test";

import { replacedByNewerPlan } from "./plans";

describe("replacedByNewerPlan", () => {
  it("replaces an earlier plan only while the newer plan is active", () => {
    const earlier = { type: "proposed_plan", id: "one", planId: "one", ordinal: 1 } as const;
    const newer = { ...earlier, id: "two", planId: "two", ordinal: 2 };
    expect(
      replacedByNewerPlan(earlier, [earlier, newer], [
        { id: "two", kind: "proposed_plan", status: "active" },
      ] as never),
    ).toBe(true);
    expect(
      replacedByNewerPlan(earlier, [earlier, newer], [
        { id: "two", kind: "proposed_plan", status: "completed" },
      ] as never),
    ).toBe(false);
  });
});
