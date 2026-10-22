// Plan first: each new request runs as a plan (T3's "plan" interaction mode), and the plan
// card's "Build it" builds that plan in the conversation's normal mode. Off by default for a
// grown-up (a per-browser choice); on and locked in a Family profile, where the engine enforces
// it whatever this browser says (apps/server/src/skycot/SkycotFamilyInstructions.ts).
import type { ProviderInteractionMode } from "@t3tools/contracts";

import { useFamily } from "../family/FamilyProvider";
import { usePlanFirstChoice } from "../settings/localPrefs";

export interface PlanFirst {
  readonly on: boolean;
  /** True in a Family profile: shown, not offered. */
  readonly locked: boolean;
}

export function planFirstFor(choice: boolean, family: boolean): PlanFirst {
  return family ? { on: true, locked: true } : { on: choice, locked: false };
}

export function usePlanFirst(): PlanFirst {
  const family = useFamily();
  const choice = usePlanFirstChoice();
  return planFirstFor(choice, family.enabled);
}

/** The mode a new request runs in. Building an approved plan is the one exception ("default"). */
export function requestMode(planFirst: PlanFirst): ProviderInteractionMode {
  return planFirst.on ? "plan" : "default";
}

export const planFirstCopy = {
  label: "Plan first",
  /** One line under the switch, in the composer and in Settings. */
  on: (builder: string) =>
    `${builder} shows you a plan first. Nothing changes until you press Build it.`,
  off: (builder: string) =>
    `${builder} starts straight away, and shows a plan only for bigger jobs.`,
  locked: (builder: string) =>
    `Family profile · ${builder} always shows a plan before making anything.`,
} as const;
