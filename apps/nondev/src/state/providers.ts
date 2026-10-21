import {
  isProviderAvailable,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ServerProvider,
} from "@t3tools/contracts";

/** "Claude", "Codex", … — the provider's own display name, else its driver slug title-cased. */
export function providerDisplayName(provider: ServerProvider): string {
  if (provider.displayName) return provider.displayName;
  const slug = String(provider.driver);
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function usableProviders(providers: ReadonlyArray<ServerProvider>): Array<ServerProvider> {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.models.length > 0,
  );
}

/**
 * The model a new conversation starts with: the project's own default when it
 * points at a usable provider, else the first usable provider's default model.
 * Null means nothing can run yet (no provider is set up) and the composer says so.
 */
export function resolveDefaultModelSelection(
  providers: ReadonlyArray<ServerProvider> | null,
  project: Pick<OrchestrationProjectShell, "defaultModelSelection"> | null,
): ModelSelection | null {
  if (providers === null) return null;
  const usable = usableProviders(providers);
  const preferred = project?.defaultModelSelection ?? null;
  if (preferred !== null) {
    const owner = usable.find((provider) => provider.instanceId === preferred.instanceId);
    if (owner && owner.models.some((model) => model.slug === preferred.model)) return preferred;
  }
  const provider = usable[0];
  if (!provider) return null;
  const model = provider.models.find((entry) => entry.isDefault) ?? provider.models[0]!;
  return { instanceId: provider.instanceId, model: model.slug };
}

export function providerForSelection(
  providers: ReadonlyArray<ServerProvider> | null,
  selection: ModelSelection | null,
): ServerProvider | null {
  if (providers === null || selection === null) return null;
  return providers.find((provider) => provider.instanceId === selection.instanceId) ?? null;
}
