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
