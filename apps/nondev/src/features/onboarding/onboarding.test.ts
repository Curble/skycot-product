import { describe, expect, it } from "vite-plus/test";

import {
  canContinue,
  onboardingProgress,
  GROWN_UP_UNTIL_DONE,
  onboardingSteps,
  projectsSummary,
  setupLanding,
  shouldShowOnboarding,
  welcomeEntry,
} from "./onboarding";

describe("onboardingSteps", () => {
  it("keeps the child setup to family code and assistant before making", () => {
    expect(onboardingSteps(null)).toEqual(["who", "assistant", "work", "autonomy", "look", "done"]);
    expect(onboardingSteps("me")).toEqual(["who", "assistant", "work", "autonomy", "look", "done"]);
    expect(onboardingSteps("child")).toEqual(["who", "family", "assistant", "done"]);
  });

  it("skips the Family set-up when a profile is already on", () => {
    expect(onboardingSteps("child", true)).not.toContain("family");
    expect(onboardingSteps("child", true)).not.toContain("picture");
    expect(onboardingSteps("child", true)).toEqual(["who", "assistant", "done"]);
  });
});

describe("onboardingProgress", () => {
  it("shows one dot per setup step and follows the current step on each path", () => {
    const me = onboardingProgress(onboardingSteps("me"), "work");
    expect(me.steps).toHaveLength(5);
    expect(me.index).toBe(2);

    const child = onboardingProgress(onboardingSteps("child"), "assistant");
    expect(child.steps).toHaveLength(3);
    expect(child.index).toBe(2);
  });

  it("keeps the final setup dot selected on done", () => {
    const progress = onboardingProgress(onboardingSteps("child"), "done");
    expect(progress.index).toBe(progress.steps.length - 1);
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
  const ready = [{ status: "ready" }] as never;
  it("shows on the welcome route regardless of state", () => {
    expect(shouldShowOnboarding({ name: "welcome" }, [], "done", true)).toBe(true);
  });
  it("stays hidden once done or skipped, and until the engine has answered", () => {
    expect(shouldShowOnboarding({ name: "home" }, [], "skipped", false)).toBe(false);
    expect(shouldShowOnboarding({ name: "home" }, null, null, false)).toBe(false);
    expect(shouldShowOnboarding({ name: "home" }, [], null, null)).toBe(false);
    expect(shouldShowOnboarding({ name: "home" }, [], null, false)).toBe(true);
  });
  // QA FK-08: a Mac with Codex already signed in skipped "Who is this for?".
  it("shows on first run even when an assistant is already signed in", () => {
    expect(shouldShowOnboarding({ name: "home" }, ready, null, false)).toBe(true);
  });
  it("is not offered to a new browser once the Family profile is on", () => {
    expect(shouldShowOnboarding({ name: "home" }, ready, null, true)).toBe(false);
  });
});

describe("welcomeEntry", () => {
  it("asks for the parent code before the welcome steps while the profile is on", () => {
    expect(welcomeEntry(true, true)).toBe("ask");
    expect(welcomeEntry(true, false)).toBe("open");
    expect(welcomeEntry(false, true)).toBe("wait");
  });
});

describe("setupLanding", () => {
  it("hands the child just set up the window, and says grown-up mode only while it is open", () => {
    expect(
      setupLanding({ childId: "ava", currentChildId: null, grownUpSessionOpen: true }),
    ).toEqual({ chooseChildId: "ava", note: GROWN_UP_UNTIL_DONE });
  });

  it("lands as the child, with no note, when no grown-up session is open", () => {
    expect(
      setupLanding({ childId: "ava", currentChildId: null, grownUpSessionOpen: false }),
    ).toEqual({ chooseChildId: "ava", note: null });
  });

  it("does not choose a child who is already the one here, or when there is none", () => {
    expect(
      setupLanding({ childId: "ava", currentChildId: "ava", grownUpSessionOpen: false })
        .chooseChildId,
    ).toBeNull();
    expect(
      setupLanding({ childId: null, currentChildId: null, grownUpSessionOpen: true }).chooseChildId,
    ).toBeNull();
  });
});

describe("projectsSummary", () => {
  it("never shows a parent the engine's folder name when setting up for a child", () => {
    expect(projectsSummary(["project"], true)).toBe("A place to make things is ready");
    expect(projectsSummary([], true)).toBe("No project yet");
  });

  it("keeps the folder's name for someone setting up for themselves", () => {
    expect(projectsSummary(["site"], false)).toBe("1 project: site");
    expect(projectsSummary(["a", "b"], false)).toBe("2 projects");
  });
});
