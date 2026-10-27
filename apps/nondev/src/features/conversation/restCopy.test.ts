// nondev-seam: skycot-iphone-q47-mac-rest-copy-test
import { describe, expect, it } from "vite-plus/test";

import { isAllowanceRestRun, restCopy } from "./restCopy";

describe("a child-friendly allowance rest card", () => {
  it("shows the reset time and one thing to do while Sam rests", () => {
    const lines = restCopy("2026-10-27T10:00:00.000Z");
    expect(lines[0]).toMatch(/^Sam can come back around /u);
    expect(lines[1]).toContain("draw what you want to make");
  });

  it("still gives calm guidance when no reset time was reported", () => {
    expect(restCopy(null)).toEqual([
      "Sam is resting. Your work is saved.",
      "You could draw while Sam rests.",
    ]);
  });

  it("hides a stale work spinner for the same run that hit an allowance limit", () => {
    const items = [
      { type: "error", runId: "run-1", failure: { class: "usage_limit" } },
      { type: "error", runId: "run-2", failure: { class: "provider_error" } },
    ];
    expect(isAllowanceRestRun("run-1", items)).toBe(true);
    expect(isAllowanceRestRun("run-2", items)).toBe(false);
    expect(isAllowanceRestRun(null, items)).toBe(false);
  });
});
