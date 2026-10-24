import type { ServerProvider } from "@t3tools/contracts";

import type { Route } from "../../router";
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
export type OnboardingStep = "who" | "family" | "assistant" | "work" | "autonomy" | "look" | "done";

/**
 * The steps in order for the chosen audience. "Who is this for?" is always
 * first; the Family set-up step exists only on the child path, and only until
 * a profile is on (re-running the steps then skips straight to the assistant).
 */
export function onboardingSteps(
  audience: Audience | null,
  familyEnabled = false,
): ReadonlyArray<OnboardingStep> {
  const family: OnboardingStep[] = audience === "child" && !familyEnabled ? ["family"] : [];
  return [
    "who",
    ...family,
    "assistant",
    "work",
    ...(audience === "child" ? [] : ["autonomy" as const]),
    "look",
    "done",
  ];
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
