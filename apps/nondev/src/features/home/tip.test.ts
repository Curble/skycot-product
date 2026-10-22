import { describe, expect, it } from "vite-plus/test";

import { homeTip, startOneHint } from "./tip";

describe("home tip", () => {
  it("speaks to a child without business words", () => {
    for (const text of [homeTip(true, "Sam"), startOneHint(true)]) {
      expect(text).not.toMatch(/staff|menu|business|customer/i);
    }
    expect(homeTip(true, "Sam")).toContain("Sam will show you a plan");
  });

  it("keeps the grown-up wording for the business set", () => {
    expect(homeTip(false, "Sam")).toContain("staff member");
    expect(startOneHint(false)).toContain("staff member");
  });
});
