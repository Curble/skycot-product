// How much the Crew may do on its own, and the engine runtime mode each choice maps to.
// Thin adapter over plain/autonomy.ts for the composer, onboarding and Settings. Every
// user-visible sentence here is honest about today's engine (SEC-01): nothing claims a rule
// is enforced unless the server says its policy is on (`ServerConfig.skycotPolicy`).
import type { RuntimeMode, ServerProvider } from "@t3tools/contracts";

import {
  AUTONOMY_LEVELS,
  AUTONOMY_ORDER,
  type AutonomyLevel,
  describeAutonomyLevel,
  HARD_RULES,
  hardRuleTitles,
  hardRulesStatement,
  PLAIN_AUTONOMY_ORDER,
} from "../../plain/autonomy";

export type Autonomy = "ask-first" | "carefully" | "hands-off";

const TO_LEVEL: Readonly<Record<Autonomy, AutonomyLevel>> = {
  "ask-first": "askMeFirst",
  carefully: "justDoItCarefully",
  "hands-off": "fullyHandsOff",
};
const FROM_LEVEL: Readonly<Record<AutonomyLevel, Autonomy>> = {
  askMeFirst: "ask-first",
  justDoItCarefully: "carefully",
  fullyHandsOff: "hands-off",
};

export function autonomyLevelOf(value: Autonomy): AutonomyLevel {
  return TO_LEVEL[value];
}

export interface AutonomyOption {
  readonly value: Autonomy;
  readonly label: string;
  readonly tag?: { readonly text: string; readonly tone?: "neutral" | "warn" };
  readonly runtimeMode: RuntimeMode;
}

function optionFor(level: AutonomyLevel): AutonomyOption {
  const info = AUTONOMY_LEVELS[level];
  return {
    value: FROM_LEVEL[level],
    label: info.label,
    runtimeMode: info.runtimeMode,
    ...(level === "askMeFirst"
      ? { tag: { text: "Default" } }
      : level === "fullyHandsOff"
        ? { tag: { text: "No safety rules", tone: "warn" as const } }
        : {}),
  };
}

/** Every level the data model knows, for Advanced/stock-style surfaces. */
export const AUTONOMY_OPTIONS: ReadonlyArray<AutonomyOption> = AUTONOMY_ORDER.map(optionFor);

/** The only levels a plain surface offers: hands-off asks nothing, so it is Advanced-only. */
export const PLAIN_AUTONOMY_OPTIONS: ReadonlyArray<AutonomyOption> =
  PLAIN_AUTONOMY_ORDER.map(optionFor);

export function isPlainAutonomy(value: Autonomy): boolean {
  return PLAIN_AUTONOMY_OPTIONS.some((option) => option.value === value);
}

/** A stored or inherited choice a plain surface cannot show falls back to asking first. */
export function plainAutonomyOrDefault(value: Autonomy): Autonomy {
  return isPlainAutonomy(value) ? value : "ask-first";
}

/**
 * The two-sentence explainer under the control. With the server policy on, the middle level
 * really is "edits free, every command checked"; off, the provider decides when to ask.
 */
export function autonomyExplainer(policyEnforced: boolean): string {
  const ask = `${AUTONOMY_LEVELS.askMeFirst.label} (safest): ${describeAutonomyLevel("askMeFirst")}`;
  const careful = `${AUTONOMY_LEVELS.justDoItCarefully.label}: ${describeAutonomyLevel(
    "justDoItCarefully",
    { policyEnforced },
  )}`;
  return `${ask} ${careful}`;
}

/** @deprecated Use `autonomyExplainer(policyEnforced)`; this is the unenforced wording. */
export const AUTONOMY_EXPLAINER = autonomyExplainer(false);

/** The hard-rule rows, lower-cased for an inline list: "deleting files or folders, …". */
export const HARD_RULE_TITLES: ReadonlyArray<string> = hardRuleTitles();

/**
 * @deprecated The old "always asks, in every mode:" tail. Kept so callers compile; it now
 * reads as a plain list of the rules and must be introduced with `hardRulesStatement`.
 */
export const ALWAYS_ASKS = `${HARD_RULE_TITLES.map((title) => title.charAt(0).toLowerCase() + title.slice(1)).join("; ")}.`;

export { HARD_RULES, hardRulesStatement };

export function autonomyLabel(value: Autonomy): string {
  return AUTONOMY_LEVELS[TO_LEVEL[value]].label;
}

export function autonomyForRuntimeMode(mode: RuntimeMode): Autonomy {
  switch (mode) {
    case "approval-required":
      return "ask-first";
    case "auto-accept-edits":
    case "auto":
      return "carefully";
    case "full-access":
      return "hands-off";
  }
}

/** Strictest first: when a provider lacks the wanted mode we fall back to one that asks more, never fewer. */
const STRICTNESS: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

/**
 * The runtime mode to send for an autonomy choice, honouring the provider's
 * `supportedRuntimeModes` when it advertises them. Falls back toward stricter
 * modes so a downgrade only ever means more questions.
 */
export function runtimeModeFor(autonomy: Autonomy, provider: ServerProvider | null): RuntimeMode {
  const wanted = AUTONOMY_LEVELS[TO_LEVEL[autonomy]].runtimeMode;
  const supported = provider?.supportedRuntimeModes;
  if (!supported || supported.length === 0 || supported.includes(wanted)) return wanted;
  const wantedIndex = STRICTNESS.indexOf(wanted);
  for (let index = wantedIndex - 1; index >= 0; index -= 1) {
    const candidate = STRICTNESS[index]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported.find((mode) => STRICTNESS.includes(mode)) ?? wanted;
}
