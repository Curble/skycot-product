// nondev-seam: skycot-policy-files
// Which model to try first. Within one provider: the provider's own default model, then the
// order of the model list's "current models" (the manifest names each provider's current line-up
// best first, e.g. Claude: Fable, Opus, Sonnet, Haiku), then, for Claude models the list does not
// name, Fable > Opus > Sonnet > Haiku, then the order the provider reports. Legacy models and
// models a person added by hand are never picked for them. Across providers: the order the engine
// lists them in (Settings' order), and only ones that are installed, switched on and signed in.

import type { ServerProvider, ServerProviderModel } from "@t3tools/contracts";

import { BUNDLED_MODEL_MANIFEST } from "../../provider/ModelManifest.ts";
import { isReadyProvider } from "./availability.ts";

/** The manifest's current line-up per driver, best first. */
export const CURRENT_MODELS: Readonly<Record<string, ReadonlyArray<string>>> =
  BUNDLED_MODEL_MANIFEST.currentModels;

const CLAUDE_TIERS = ["fable", "opus", "sonnet", "haiku"] as const;

function claudeTier(model: ServerProviderModel): number {
  const text = `${model.slug} ${model.name}`.toLowerCase();
  const index = CLAUDE_TIERS.findIndex((tier) => text.includes(tier));
  return index === -1 ? CLAUDE_TIERS.length : index;
}

/** The models a fallback may pick, best first. */
export function rankModels(
  provider: Pick<ServerProvider, "driver" | "models">,
  currentModels: Readonly<Record<string, ReadonlyArray<string>>> = CURRENT_MODELS,
): ReadonlyArray<ServerProviderModel> {
  const driver = String(provider.driver);
  const lineUp = currentModels[driver] ?? [];
  const position = (model: ServerProviderModel) => {
    const index = lineUp.indexOf(model.slug);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return provider.models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => model.isLegacy !== true && !model.isCustom)
    .toSorted(
      (left, right) =>
        Number(right.model.isDefault === true) - Number(left.model.isDefault === true) ||
        position(left.model) - position(right.model) ||
        (driver === "claudeAgent" ? claudeTier(left.model) - claudeTier(right.model) : 0) ||
        left.index - right.index,
    )
    .map(({ model }) => model);
}

/** Other providers the family signed in to, in the engine's order. */
export function otherReadyProviders(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: string,
): ReadonlyArray<ServerProvider> {
  return providers.filter(
    (provider) => String(provider.instanceId) !== instanceId && isReadyProvider(provider),
  );
}
