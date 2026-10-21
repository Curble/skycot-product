import { describe, expect, it } from "vite-plus/test";

import { canContinue, onboardingSteps, shouldShowOnboarding } from "./onboarding";

describe("onboardingSteps", () => {
  it("always starts with who, adds the Family step on the child path only", () => {
    expect(onboardingSteps(null)).toEqual(["who", "assistant", "work", "autonomy", "look", "done"]);
    expect(onboardingSteps("me")).toEqual(["who", "assistant", "work", "autonomy", "look", "done"]);
    expect(onboardingSteps("child")).toEqual([
      "who",
      "family",
      "assistant",
      "work",
      "autonomy",
      "look",
      "done",
    ]);
  });

  it("skips the Family set-up when a profile is already on", () => {
    expect(onboardingSteps("child", true)).not.toContain("family");
    expect(onboardingSteps("child", true)[0]).toBe("who");
  });
});

describe("canContinue", () => {
  it("waits for an audience, then for a ready code, and never blocks elsewhere", () => {
    expect(canContinue("who", null, false)).toBe(false);
    expect(canContinue("who", "me", false)).toBe(true);
    expect(canContinue("family", "child", false)).toBe(false);
    expect(canContinue("family", "child", true)).toBe(true);
    expect(canContinue("assistant", null, false)).toBe(true);
    expect(canContinue("done", null, false)).toBe(true);
  });
});

describe("shouldShowOnboarding", () => {
  it("shows on the welcome route regardless of state", () => {
    expect(shouldShowOnboarding({ name: "welcome" }, [], "done")).toBe(true);
  });
  it("stays hidden once done or skipped, and until the engine has answered", () => {
    expect(shouldShowOnboarding({ name: "home" }, [], "skipped")).toBe(false);
    expect(shouldShowOnboarding({ name: "home" }, null, null)).toBe(false);
    expect(shouldShowOnboarding({ name: "home" }, [], null)).toBe(true);
  });
});
