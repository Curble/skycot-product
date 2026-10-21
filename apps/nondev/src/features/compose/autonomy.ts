// How much the Crew may do on its own, and the engine runtime mode each choice
// maps to. A plain/autonomy.ts module is planned to replace this; until then the
// three labels stay identical to plain/copy.ts `autonomy`.
import type { RuntimeMode, ServerProvider } from "@t3tools/contracts";

export type Autonomy = "ask-first" | "carefully" | "hands-off";

export const AUTONOMY_OPTIONS: ReadonlyArray<{
  readonly value: Autonomy;
  readonly label: string;
  readonly tag?: { readonly text: string; readonly tone?: "neutral" | "warn" };
  readonly runtimeMode: RuntimeMode;
}> = [
  {
    value: "ask-first",
    label: "Ask me first",
    tag: { text: "Default" },
    runtimeMode: "approval-required",
  },
  { value: "carefully", label: "Just do it, carefully", runtimeMode: "auto-accept-edits" },
  {
    value: "hands-off",
    label: "Fully hands-off",
    tag: { text: "Riskier", tone: "warn" },
    runtimeMode: "full-access",
  },
];

export const AUTONOMY_EXPLAINER =
  "Ask me first (safest): Crew shows you a plan and checks before every change. Just do it, carefully: edits freely, still asks before installing or running anything. Fully hands-off: works alone; for small, low-risk jobs only.";

export const ALWAYS_ASKS =
  "deleting anything, putting anything live, spending money or signing up to a service, touching bookings or customer details.";

export function autonomyLabel(value: Autonomy): string {
  return AUTONOMY_OPTIONS.find((option) => option.value === value)?.label ?? value;
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
  const wanted = AUTONOMY_OPTIONS.find((option) => option.value === autonomy)!.runtimeMode;
  const supported = provider?.supportedRuntimeModes;
  if (!supported || supported.length === 0 || supported.includes(wanted)) return wanted;
  const wantedIndex = STRICTNESS.indexOf(wanted);
  for (let index = wantedIndex - 1; index >= 0; index -= 1) {
    const candidate = STRICTNESS[index]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported.find((mode) => STRICTNESS.includes(mode)) ?? wanted;
}
