import type { ServerProvider } from "@t3tools/contracts";

import type { Route } from "../../router";
import { anyProviderReady } from "../settings/providerCatalog";
import type { OnboardingState } from "../settings/localPrefs";

/**
 * The welcome steps show on `#/welcome` always, and otherwise only until one
 * assistant is ready or the person has skipped them. `providers === null`
 * means the engine hasn't answered yet, so nothing is decided.
 */
export function shouldShowOnboarding(
  route: Route,
  providers: ReadonlyArray<ServerProvider> | null,
  state: OnboardingState,
): boolean {
  if (route.name === "welcome") return true;
  if (state !== null) return false;
  if (providers === null) return false;
  return !anyProviderReady(providers);
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
  return ["who", ...family, "assistant", "work", "autonomy", "look", "done"];
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
