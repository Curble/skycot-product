import { describe, expect, it } from "vite-plus/test";

import { vi } from "vite-plus/test";

import onboardingSheetSource from "./OnboardingSheet.tsx?raw";
import pictureStepSource from "./PictureStep.tsx?raw";
import familySetupFormSource from "../family/FamilySetupForm.tsx?raw";
import familyAssistantsGroupSource from "../family/FamilyAssistantsGroup.tsx?raw";
import familyPaneSource from "../settings/panes/FamilyPane.tsx?raw";
import familyCopySource from "../family/copy.ts?raw";
import { familyCopy } from "../family/copy";
import { mascotCopy } from "../brand/mascotCopy";
import { familyAgeTermsNote } from "../family/assistantAllowance";
import {
  addSibling,
  handOverLabel,
  siblingPatch,
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
    expect(onboardingSteps("child")).toEqual(["who", "family", "children", "assistant", "done"]);
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
    expect(child.steps).toHaveLength(4);
    expect(child.index).toBe(3);
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

describe("adding more children during set-up", () => {
  it("saves two children through the family API, each with its own colour and band", async () => {
    const added: unknown[] = [];
    const add = vi.fn(async (patch: unknown) => {
      added.push(patch);
      return { ok: true as const };
    });
    expect(
      await addSibling({ name: "  Theo ", readingLevel: "makers", childrenSoFar: 1 }, add),
    ).toEqual({
      ok: true,
    });
    await addSibling({ name: "Isla", readingLevel: "little-makers", childrenSoFar: 2 }, add);
    expect(add).toHaveBeenCalledTimes(2);
    const [theo, isla] = added as ReturnType<typeof siblingPatch>[];
    expect(theo).toMatchObject({ name: "Theo", readingLevel: "makers" });
    expect(isla).toMatchObject({ name: "Isla", readingLevel: "little-makers" });
    expect(theo!.avatar).not.toEqual(isla!.avatar);
  });

  it("does not save a child without a name", async () => {
    const add = vi.fn(async () => ({ ok: true as const }));
    expect(
      await addSibling({ name: "  ", readingLevel: "makers", childrenSoFar: 1 }, add),
    ).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it("names the first child on the hand-over button", () => {
    expect(handOverLabel("Mia")).toBe("Ready — hand SKYCOT to Mia");
    expect(handOverLabel(null)).toBe("Ready — hand SKYCOT to your child");
  });
});

const BANNED = /\b(engine|assistants?|autonomy|developer|dev tools?)\b/i;

/** Every sentence a parent can read in a source file: quoted strings with a space in them, and JSX text. */
function readableStrings(raw: string): string[] {
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^import[\s\S]*?from\s+"[^"]*";$/gm, "");
  const found: string[] = [];
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    // `${...}` holes are code, not words.
    const text = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, "");
    if (/\s/.test(text.trim())) found.push(text);
  }
  for (const match of source.matchAll(/(?<![=-])>([^<>{}]*[A-Za-z][^<>{}]*)</g))
    found.push(match[1]!);
  return found;
}

describe("plain family words in set-up and the Family screen", () => {
  const files: Record<string, string> = {
    "OnboardingSheet.tsx": onboardingSheetSource,
    "PictureStep.tsx": pictureStepSource,
    "FamilySetupForm.tsx": familySetupFormSource,
    "FamilyAssistantsGroup.tsx": familyAssistantsGroupSource,
    "FamilyPane.tsx": familyPaneSource,
    "copy.ts": familyCopySource,
  };
  for (const [file, source] of Object.entries(files)) {
    it(`${file} has no developer words`, () => {
      // "This assistant" is a code comparison against the rules package's fallback title, never shown.
      const offending = readableStrings(source).filter(
        (text) => BANNED.test(text) && text !== "This assistant",
      );
      expect(offending).toEqual([]);
    });
  }

  it("the shared sentences a parent reads carry none either", () => {
    const lines = [
      ...Object.values(familyCopy).flatMap((value) => (Array.isArray(value) ? value : [value])),
      mascotCopy.introduction,
      familyAgeTermsNote(),
    ].filter((value): value is string => typeof value === "string");
    expect(lines.filter((text) => BANNED.test(text))).toEqual([]);
  });
});
