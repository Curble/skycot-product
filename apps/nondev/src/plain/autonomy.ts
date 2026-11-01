import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";

import { EFFORT_OPTION_IDS } from "@t3tools/skycot-rules/depth";
import { SPEED_OPTION_IDS } from "@t3tools/skycot-rules/speed";
import { HARD_RULES, type HardRule } from "@t3tools/skycot-rules/rules";

import { autonomy as copy, care as careCopy, hardRulesStatement } from "./copy";

export { HARD_RULES, hardRulesStatement, type HardRule };

export type AutonomyLevel = "askMeFirst" | "justDoItCarefully" | "fullyHandsOff";

export interface AutonomyLevelInfo {
  readonly level: AutonomyLevel;
  readonly runtimeMode: RuntimeMode;
  readonly label: string;
  readonly description: string;
  readonly hint: string;
  readonly risk: "low" | "medium" | "high";
  readonly warning?: string;
  readonly advanced: string;
}

export const DEFAULT_AUTONOMY: AutonomyLevel = "askMeFirst";

export const AUTONOMY_LEVELS: Readonly<Record<AutonomyLevel, AutonomyLevelInfo>> = {
  askMeFirst: {
    level: "askMeFirst",
    runtimeMode: "approval-required",
    label: copy.askMeFirst.label,
    description: copy.askMeFirst.description,
    hint: copy.askMeFirst.hint,
    risk: "low",
    advanced: "Advanced: permission mode 'approval-required' (Supervised)",
  },
  justDoItCarefully: {
    level: "justDoItCarefully",
    runtimeMode: "auto-accept-edits",
    label: copy.justDoItCarefully.label,
    description: copy.justDoItCarefully.description,
    hint: copy.justDoItCarefully.hint,
    risk: "medium",
    advanced: "Advanced: permission mode 'auto-accept-edits'",
  },
  fullyHandsOff: {
    level: "fullyHandsOff",
    runtimeMode: "full-access",
    label: copy.fullyHandsOff.label,
    description: copy.fullyHandsOff.description,
    hint: copy.fullyHandsOff.hint,
    risk: "high",
    warning: copy.fullyHandsOff.warning,
    advanced: "Advanced: permission mode 'full-access' (no prompts, no sandbox)",
  },
};

export const AUTONOMY_ORDER: ReadonlyArray<AutonomyLevel> = [
  "askMeFirst",
  "justDoItCarefully",
  "fullyHandsOff",
];

/**
 * The levels a plain surface (composer, onboarding, Settings) may offer. "Fully hands-off"
 * stays in the data model for Advanced mode and for profiles that hide it, but it is never a
 * plain choice: it asks nothing, so no safety promise can be kept there (SEC-01).
 */
export const PLAIN_AUTONOMY_ORDER: ReadonlyArray<AutonomyLevel> = [
  "askMeFirst",
  "justDoItCarefully",
];

export function plainAutonomyLevels(): ReadonlyArray<AutonomyLevelInfo> {
  return PLAIN_AUTONOMY_ORDER.map((level) => AUTONOMY_LEVELS[level]);
}

export function isPlainAutonomyLevel(level: AutonomyLevel): boolean {
  return PLAIN_AUTONOMY_ORDER.includes(level);
}

export interface AutonomyPolicyContext {
  /** True only when the server reports `skycotPolicy: true` in its config. */
  readonly policyEnforced: boolean;
}

/**
 * The description to show for a level, honest about enforcement. Only the middle level
 * changes: with the server policy on, every command is checked against the hard rules; off,
 * the provider decides when to ask.
 */
export function describeAutonomyLevel(
  level: AutonomyLevel,
  context: AutonomyPolicyContext = { policyEnforced: false },
): string {
  if (level === "justDoItCarefully" && context.policyEnforced) {
    return copy.justDoItCarefully.descriptionEnforced;
  }
  return AUTONOMY_LEVELS[level].description;
}

/** The hard-rule rows Settings lists, in order. */
export function hardRuleTitles(): ReadonlyArray<string> {
  return HARD_RULES.map((rule) => rule.title);
}

export function autonomyToRuntimeMode(level: AutonomyLevel): RuntimeMode {
  return AUTONOMY_LEVELS[level].runtimeMode;
}

/** `auto` (the provider's own reviewer) has no slider stop; it reads as the careful middle. */
export function runtimeModeToAutonomy(mode: RuntimeMode): AutonomyLevel {
  switch (mode) {
    case "approval-required":
      return "askMeFirst";
    case "auto-accept-edits":
    case "auto":
      return "justDoItCarefully";
    case "full-access":
      return "fullyHandsOff";
  }
}

/**
 * The mode the engine really runs a conversation in. With the Family profile on, every turn's
 * assistant asks before every step whatever the conversation was created with (the engine
 * enforces it), and the engine itself answers the safe ones under the Family rules, so a
 * conversation made "Fully hands-off" before the profile was turned on must not say so. The
 * words for a Family conversation come from `familySteps` (features/family/copy.ts).
 */
export function enforcedRuntimeMode(mode: RuntimeMode, familyOn: boolean): RuntimeMode {
  return familyOn ? "approval-required" : mode;
}

/**
 * Which runtime modes each provider family accepts. Mirrors each provider package's
 * server status file; a provider absent here supports all four. The
 * live `supportedRuntimeModes` from the provider snapshot wins when the caller has it.
 */
export const PROVIDER_RUNTIME_MODE_MATRIX: Readonly<Record<string, ReadonlyArray<RuntimeMode>>> = {
  codex: ["approval-required", "auto-accept-edits", "auto", "full-access"],
  claudeAgent: ["approval-required", "auto-accept-edits", "auto", "full-access"],
  cursor: ["approval-required", "auto-accept-edits", "auto", "full-access"],
  opencode: ["approval-required", "auto-accept-edits", "auto", "full-access"],
  antigravity: ["approval-required", "auto-accept-edits", "full-access"],
  grok: ["approval-required", "auto", "full-access"],
  pi: ["approval-required", "auto-accept-edits", "full-access"],
  muse: ["approval-required", "full-access"],
  acpRegistry: ["approval-required", "full-access"],
};

export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  codex: "Codex (ChatGPT)",
  claudeAgent: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
  antigravity: "Antigravity (Google)",
  grok: "Grok",
  pi: "Pi",
  muse: "Muse",
  acpRegistry: "this assistant",
};

export interface ResolvedAutonomy {
  readonly requested: AutonomyLevel;
  readonly effective: AutonomyLevel;
  readonly runtimeMode: RuntimeMode;
  readonly available: boolean;
  /** Set when the provider can't do the requested level and we fell back. */
  readonly fallbackFrom?: AutonomyLevel;
  readonly explanation: string;
  readonly availableLevels: ReadonlyArray<AutonomyLevel>;
}

export interface ProviderModeSource {
  readonly driver?: string | null;
  readonly displayName?: string | null;
  /** From the provider snapshot; empty or missing means "no restriction". */
  readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode> | null;
}

function supportedModes(provider: ProviderModeSource): ReadonlyArray<RuntimeMode> {
  if (provider.supportedRuntimeModes && provider.supportedRuntimeModes.length > 0)
    return provider.supportedRuntimeModes;
  if (provider.driver && PROVIDER_RUNTIME_MODE_MATRIX[provider.driver])
    return PROVIDER_RUNTIME_MODE_MATRIX[provider.driver]!;
  return ["approval-required", "auto-accept-edits", "auto", "full-access"];
}

/**
 * Picks the runtime mode for a level on a given provider. Falls back towards *more* questions,
 * never fewer: a missing "carefully" becomes "ask me first", and hands-off is only ever the
 * real `full-access` (it is never emulated with `auto`).
 */
export function resolveAutonomyForProvider(
  requested: AutonomyLevel,
  provider: ProviderModeSource = {},
): ResolvedAutonomy {
  const modes = supportedModes(provider);
  const availableLevels = AUTONOMY_ORDER.filter((level) =>
    modes.includes(AUTONOMY_LEVELS[level].runtimeMode),
  );
  const name =
    provider.displayName ??
    (provider.driver ? PROVIDER_DISPLAY_NAMES[provider.driver] : undefined) ??
    "This assistant";
  const wanted = AUTONOMY_LEVELS[requested];
  if (modes.includes(wanted.runtimeMode)) {
    return {
      requested,
      effective: requested,
      runtimeMode: wanted.runtimeMode,
      available: true,
      explanation: requested === "fullyHandsOff" ? wanted.warning! : wanted.description,
      availableLevels,
    };
  }
  // Only "justDoItCarefully" can be missing in practice (approval-required and full-access are
  // universal). Walk down towards "askMeFirst".
  const index = AUTONOMY_ORDER.indexOf(requested);
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = AUTONOMY_ORDER[i]!;
    if (modes.includes(AUTONOMY_LEVELS[candidate].runtimeMode)) {
      return {
        requested,
        effective: candidate,
        runtimeMode: AUTONOMY_LEVELS[candidate].runtimeMode,
        available: false,
        fallbackFrom: requested,
        explanation: copy.fallback(wanted.label, AUTONOMY_LEVELS[candidate].label, name),
        availableLevels,
      };
    }
  }
  return {
    requested,
    effective: "askMeFirst",
    runtimeMode: "approval-required",
    available: false,
    fallbackFrom: requested,
    explanation: copy.fallback(wanted.label, AUTONOMY_LEVELS.askMeFirst.label, name),
    availableLevels,
  };
}

/** The sentence under the slider when the provider has an `auto` reviewer mode. */
export function autoModeNote(provider: ProviderModeSource): string | undefined {
  return supportedModes(provider).includes("auto") ? copy.autoModeNote : undefined;
}

export type CareLevel = "careful" | "balanced" | "quick";
export type SpeedLevel = "normal" | "fast" | "fastest";

export interface TraitChoice<Level extends string> {
  readonly level: Level;
  readonly label: string;
  readonly description: string;
  /** The real option value to send in `ModelSelection.options`. */
  readonly value: string;
  readonly isDefault: boolean;
  readonly costNote?: string;
}

export interface TraitMapping<Level extends string> {
  readonly optionId: string;
  readonly advanced: string;
  readonly choices: ReadonlyArray<TraitChoice<Level>>;
  readonly current?: Level;
}

export interface SpeedCareModel {
  readonly care?: TraitMapping<CareLevel>;
  readonly speed?: TraitMapping<SpeedLevel>;
}

function careLevelFor(choiceId: string, index: number, total: number): CareLevel {
  const id = choiceId.toLowerCase();
  if (/^(xhigh|max|maximum|highest|ultra|extra)/.test(id) || id === "high") return "careful";
  if (/^(low|minimal|min|none|off|fast)/.test(id)) return "quick";
  if (/^(medium|default|standard|balanced|auto)/.test(id)) return "balanced";
  // Unknown ids: position decides. Lower third quick, upper third careful.
  if (total <= 1) return "balanced";
  const ratio = index / (total - 1);
  return ratio < 0.34 ? "quick" : ratio > 0.66 ? "careful" : "balanced";
}

function speedLevelFor(choiceId: string): SpeedLevel {
  const id = choiceId.toLowerCase();
  if (/ultra|fastest|priority|premium/.test(id)) return "fastest";
  if (/fast|flex|quick/.test(id)) return "fast";
  return "normal";
}

/**
 * Collapses the provider's effort / speed option descriptors into "Careful / Balanced / Quick" and
 * "Normal / Faster / Fastest". Several real values may share a level; the first one listed is the
 * value sent for that level. Boolean fast-mode toggles become a two-stop speed.
 */
export function describeSpeedCare(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | undefined,
): SpeedCareModel {
  const result: { care?: TraitMapping<CareLevel>; speed?: TraitMapping<SpeedLevel> } = {};
  for (const descriptor of descriptors ?? []) {
    if (EFFORT_OPTION_IDS.has(descriptor.id) && descriptor.type === "select" && !result.care) {
      const choices = descriptor.options.map((choice, index, all) => {
        const level = careLevelFor(choice.id, index, all.length);
        return {
          level,
          label: careCopy[level].label,
          description: choice.description ?? careCopy[level].description,
          value: choice.id,
          isDefault: choice.isDefault === true,
          ...(level === "careful" ? { costNote: "Slower and uses more of your allowance." } : {}),
        } satisfies TraitChoice<CareLevel>;
      });
      const current = descriptor.currentValue
        ? choices.find((c) => c.value === descriptor.currentValue)?.level
        : undefined;
      result.care = {
        optionId: descriptor.id,
        advanced: `Advanced: ${descriptor.label} (${descriptor.id})`,
        choices: dedupeByLevel(choices),
        ...(current ? { current } : {}),
      };
    }
    if (SPEED_OPTION_IDS.has(descriptor.id) && !result.speed) {
      if (descriptor.type === "select") {
        const choices = descriptor.options.map((choice) => {
          const level = speedLevelFor(choice.id);
          const c =
            level === "normal"
              ? careCopy.speedNormal
              : level === "fast"
                ? careCopy.speedFast
                : careCopy.speedFastest;
          return {
            level,
            label: c.label,
            description: choice.description ?? c.description,
            value: choice.id,
            isDefault: choice.isDefault === true,
            ...(level !== "normal" ? { costNote: "Costs more per request." } : {}),
          } satisfies TraitChoice<SpeedLevel>;
        });
        const current = descriptor.currentValue
          ? choices.find((c) => c.value === descriptor.currentValue)?.level
          : undefined;
        result.speed = {
          optionId: descriptor.id,
          advanced: `Advanced: ${descriptor.label} (${descriptor.id})`,
          choices: dedupeByLevel(choices),
          ...(current ? { current } : {}),
        };
      } else {
        const choices: ReadonlyArray<TraitChoice<SpeedLevel>> = [
          {
            level: "normal",
            label: careCopy.speedNormal.label,
            description: careCopy.speedNormal.description,
            value: "false",
            isDefault: descriptor.currentValue !== true,
          },
          {
            level: "fast",
            label: careCopy.speedFast.label,
            description: careCopy.speedFast.description,
            value: "true",
            isDefault: descriptor.currentValue === true,
            costNote: "Costs more per request.",
          },
        ];
        result.speed = {
          optionId: descriptor.id,
          advanced: `Advanced: ${descriptor.label} (${descriptor.id}, on/off)`,
          choices,
          current: descriptor.currentValue === true ? "fast" : "normal",
        };
      }
    }
  }
  return result;
}

function dedupeByLevel<Level extends string>(
  choices: ReadonlyArray<TraitChoice<Level>>,
): Array<TraitChoice<Level>> {
  const seen = new Map<Level, TraitChoice<Level>>();
  for (const choice of choices) {
    const existing = seen.get(choice.level);
    // Prefer the provider's default for a level; otherwise keep the first.
    if (!existing || (choice.isDefault && !existing.isDefault)) seen.set(choice.level, choice);
  }
  return [...seen.values()];
}
