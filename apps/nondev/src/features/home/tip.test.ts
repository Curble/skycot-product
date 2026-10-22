import { describe, expect, it } from "vite-plus/test";

import { emptyConversationHint, homeTip, startOneHint } from "./tip";

describe("home tip", () => {
  it("speaks to a child without business words", () => {
    for (const text of [
      homeTip(true, "Sam", true),
      homeTip(true, "Sam", false),
      startOneHint(true),
    ]) {
      expect(text).not.toMatch(/staff|menu|business|customer/i);
    }
  });

  it("promises a plan only when plan first is on (F6)", () => {
    expect(homeTip(true, "Sam", true)).toContain("Sam will show you a plan before making anything");
    expect(homeTip(false, "Sam", true)).toContain("Sam will show you a plan");
    expect(homeTip(true, "Sam", false)).not.toMatch(/plan/i);
    expect(homeTip(true, "Sam", false)).toContain("Sam checks with you before anything risky");
    expect(homeTip(false, "Sam", false)).not.toContain("will show you a plan");
    expect(homeTip(false, "Sam", false)).toContain("Plan first");
  });

  it("keeps the grown-up wording for the business set", () => {
    expect(homeTip(false, "Sam", false)).toContain("staff member");
    expect(startOneHint(false)).toContain("staff member");
  });
});

describe("empty conversation hint (L2)", () => {
  it("promises a plan only when plan first is on, like the Home tip", () => {
    expect(emptyConversationHint("Sam", true)).toBe(
      "Say what you'd like done and Sam will show you a plan first.",
    );
    expect(emptyConversationHint("Sam", false)).not.toMatch(/plan/i);
  });
});
