import {
  isProviderAvailable,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";

import { getOnboardingProviderState } from "~/onboarding/providerReadiness.logic";

import { assistantFamilyState } from "../features/family/assistantAllowance";

/** "Claude", "Codex", … — the provider's own display name, else its driver slug title-cased. */
export function providerDisplayName(provider: ServerProvider): string {
  if (provider.displayName) return provider.displayName;
  const slug = String(provider.driver);
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Could run a turn: switched on, installed, offered, with models, and not known to be signed
 * out. A provider the engine says is signed out is never a default, whatever else it reports:
 * a new conversation on it would only fail.
 */
function usableProviders(providers: ReadonlyArray<ServerProvider>): Array<ServerProvider> {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.models.length > 0 &&
      provider.auth.status !== "unauthenticated",
  );
}

/** Signed in and working, exactly as Settings' green "Ready" means it. */
export function isReadyProvider(provider: ServerProvider): boolean {
  return getOnboardingProviderState(provider) === "ready";
}

/**
 * The person's own pick in Settings › AI assistants › Use by default (the engine's
 * `defaultModelSelection` setting, shared with Advanced mode). Null is "Automatic".
 */
export interface DefaultAssistantPreference {
  readonly chosen: ModelSelection | null;
  /** With the Family profile on: the assistants a child may use. The allowance always wins. */
  readonly mayUse?: (driver: string) => boolean;
}

/** The preference from the engine's settings and the Family profile. */
export function defaultAssistantPreference(
  settings: Pick<ServerSettings, "defaultModelSelection"> | null,
  family: { readonly enabled: boolean; readonly allowedAssistants: ReadonlyArray<string> },
): DefaultAssistantPreference {
  const chosen = settings?.defaultModelSelection ?? null;
  if (!family.enabled) return { chosen };
  const allowed = family.allowedAssistants;
  return {
    chosen,
    // Codex and Claude run locked down; any other assistant only once a grown-up allowed it.
    mayUse: (driver) => assistantFamilyState(driver, allowed) !== "not-allowed",
  };
}

function defaultModelOf(provider: ServerProvider): ModelSelection {
  const model = provider.models.find((entry) => entry.isDefault) ?? provider.models[0]!;
  return { instanceId: provider.instanceId, model: model.slug };
}

/**
 * The chosen assistant when it can be used right now: signed in (or at least not signed out
 * and not failing), and allowed for the Family profile. Its stored model when that is still
 * offered, else the assistant's own default model.
 */
export function usableChosenSelection(
  providers: ReadonlyArray<ServerProvider> | null,
  preference: DefaultAssistantPreference | undefined,
): ModelSelection | null {
  const chosen = preference?.chosen ?? null;
  if (providers === null || chosen === null) return null;
  const owner = usableProviders(providers).find(
    (provider) => provider.instanceId === chosen.instanceId,
  );
  if (!owner || owner.status === "error") return null;
  if (preference?.mayUse && !preference.mayUse(String(owner.driver))) return null;
  return owner.models.some((model) => model.slug === chosen.model) ? chosen : defaultModelOf(owner);
}

/** "Automatic": the first assistant that is ready, else the first that might still run. */
export function automaticModelSelection(
  providers: ReadonlyArray<ServerProvider> | null,
): ModelSelection | null {
  if (providers === null) return null;
  const usable = usableProviders(providers);
  const provider = usable.find(isReadyProvider) ?? usable[0];
  return provider ? defaultModelOf(provider) : null;
}

/**
 * The model a new conversation starts with: the project's own default when it points at a
 * usable provider, else the person's chosen default when it can run now, else the first ready
 * provider's default model. Null means nothing can run yet (no provider is set up) and the
 * composer says so.
 */
export function resolveDefaultModelSelection(
  providers: ReadonlyArray<ServerProvider> | null,
  project: Pick<OrchestrationProjectShell, "defaultModelSelection"> | null,
  preference?: DefaultAssistantPreference,
): ModelSelection | null {
  if (providers === null) return null;
  const usable = usableProviders(providers);
  const preferred = project?.defaultModelSelection ?? null;
  if (preferred !== null) {
    const owner = usable.find((provider) => provider.instanceId === preferred.instanceId);
    if (owner && owner.models.some((model) => model.slug === preferred.model)) return preferred;
  }
  return usableChosenSelection(providers, preference) ?? automaticModelSelection(providers);
}

export function providerForSelection(
  providers: ReadonlyArray<ServerProvider> | null,
  selection: ModelSelection | null,
): ServerProvider | null {
  if (providers === null || selection === null) return null;
  return providers.find((provider) => provider.instanceId === selection.instanceId) ?? null;
}
