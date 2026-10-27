import type { ServerProvider } from "@t3tools/contracts";

import type { Route } from "../../router";
import { draftFor, patchFor } from "../family/ChildEditorSheet";
import type { ChildPatch } from "../family/api";
import type { ReadingLevel } from "../family/children";
import type { OnboardingState } from "../settings/localPrefs";

/**
 * First run: the welcome steps open until the person finishes or skips them in this browser,
 * whether or not an assistant is already signed in, because the first step ("Who is this
 * for?") is where a parent turns the Family profile on (QA FK-08). Nothing is decided until
 * the engine has answered for both the assistants and the profile (`null`), and a browser
 * opened on a Mac whose Family profile is already on skips them: the parent set it up, and a
 * child should not be offered the set-up. `#/welcome` is handled by the caller (it asks for
 * the parent code while the profile is on).
 */
export function shouldShowOnboarding(
  route: Route,
  providers: ReadonlyArray<ServerProvider> | null,
  state: OnboardingState,
  familyEnabled: boolean | null,
): boolean {
  if (route.name === "welcome") return true;
  if (state !== null) return false;
  if (providers === null || familyEnabled === null) return false;
  return !familyEnabled;
}

/**
 * What opening `#/welcome` does: wait for the engine's answer, open the steps, or ask for the
 * parent code first while the Family profile is on (QA FK-09: the typed address skipped it).
 */
export function welcomeEntry(familyKnown: boolean, locked: boolean): "wait" | "open" | "ask" {
  if (!familyKnown) return "wait";
  return locked ? "ask" : "open";
}

export type Audience = "me" | "child";
export type OnboardingStep =
  | "who"
  | "family"
  | "children"
  | "picture"
  | "assistant"
  | "work"
  | "autonomy"
  | "look"
  | "done";

/**
 * The steps in order for the chosen audience. "Who is this for?" is always
 * first; the Family set-up step exists only on the child path, and only until
 * a profile is on (re-running the steps then skips straight to the assistant).
 */
export function onboardingSteps(
  audience: Audience | null,
  familyEnabled = false,
): ReadonlyArray<OnboardingStep> {
  // A child needs the parent code and an assistant before making a first thing. Pictures,
  // folders and looks can be changed after the child lands in the Workshop.
  const family: OnboardingStep[] =
    audience === "child" && !familyEnabled ? ["family", "children"] : [];
  return [
    "who",
    ...family,
    "assistant",
    ...(audience === "child" ? [] : ["work" as const]),
    ...(audience === "child" ? [] : ["autonomy" as const]),
    ...(audience === "child" ? [] : ["look" as const]),
    "done",
  ];
}

/** Progress dots track setup steps, ending on the last dot when the sheet is done. */
export function onboardingProgress(
  steps: ReadonlyArray<OnboardingStep>,
  step: OnboardingStep,
): { readonly steps: ReadonlyArray<OnboardingStep>; readonly index: number } {
  const progressSteps = steps.filter((entry) => entry !== "done");
  const stepIndex = steps.indexOf(step);
  return {
    steps: progressSteps,
    index: Math.min(Math.max(0, stepIndex), progressSteps.length - 1),
  };
}

/** Whether "Continue" is live on a step; the others never block. */
export function canContinue(
  step: OnboardingStep,
  audience: Audience | null,
  familyDraftReady: boolean,
): boolean {
  if (step === "who") return audience !== null;
  if (step === "family") return familyDraftReady;
  return true;
}

/**
 * The one tap on "Who is this for?": how simply Sam explains. Only the band is kept (the
 * engine's existing reading level); no age number is asked for, stored or sent to the AI.
 */
export const READING_BANDS: ReadonlyArray<{
  readonly value: ReadingLevel;
  readonly label: string;
}> = [
  { value: "little-makers", label: "Little makers (5–7)" },
  { value: "makers", label: "Makers (8–10)" },
  { value: "big-makers", label: "Big makers (11+)" },
];

export const GROWN_UP_UNTIL_DONE = "You're in grown-up mode until you press Done.";

/**
 * Where the end of child set-up leaves the window. The child just set up becomes the one using
 * SKYCOT here (so the grown-up's Done hands over to their Let's make screen, not a picker). The
 * note about grown-up mode is only true, and only shown, while a grown-up session is open;
 * otherwise the window simply lands as the child.
 */
export function setupLanding(input: {
  readonly childId: string | null;
  readonly currentChildId: string | null;
  readonly grownUpSessionOpen: boolean;
}): { readonly chooseChildId: string | null; readonly note: string | null } {
  return {
    chooseChildId:
      input.childId !== null && input.childId !== input.currentChildId ? input.childId : null,
    note: input.grownUpSessionOpen ? GROWN_UP_UNTIL_DONE : null,
  };
}

/**
 * The "You're set" line about projects. A parent setting up for a child does not need the name
 * of the folder the engine happened to start in ("1 project: project"); they need to know a
 * place to make things exists. Someone setting up for themselves still sees the folder's name.
 */
export function projectsSummary(titles: ReadonlyArray<string>, forChild: boolean): string {
  if (titles.length === 0) return "No project yet";
  if (forChild)
    return titles.length === 1
      ? "A place to make things is ready"
      : "Places to make things are ready";
  return titles.length === 1 ? `1 project: ${titles[0]}` : `${titles.length} projects`;
}

/**
 * A brother or sister added during set-up: just a name and a reading band. The picture colour
 * follows on from the children already saved, and everything else starts at the same sensible
 * defaults as Settings › Family › Add another child.
 */
export function siblingPatch(
  name: string,
  readingLevel: ReadingLevel,
  childrenSoFar: number,
): ChildPatch {
  return patchFor({ ...draftFor(null, childrenSoFar), name, readingLevel });
}

/** Saves one more child through the family API; `add` is the store's `addChild`. */
export async function addSibling<R extends { readonly ok: boolean }>(
  input: {
    readonly name: string;
    readonly readingLevel: ReadingLevel;
    readonly childrenSoFar: number;
  },
  add: (patch: ChildPatch) => Promise<R>,
): Promise<R | null> {
  const name = input.name.trim();
  if (name.length === 0) return null;
  return add(siblingPatch(name, input.readingLevel, input.childrenSoFar));
}

/** The name on the hand-over button, with a kind fallback when the first child has none. */
export function handOverLabel(firstChildName: string | null | undefined): string {
  const name = firstChildName?.trim();
  return `Ready — hand SKYCOT to ${name ? name : "your child"}`;
}
