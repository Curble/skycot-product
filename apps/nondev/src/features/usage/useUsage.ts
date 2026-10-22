import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { Atom } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { providerForSelection, resolveDefaultModelSelection } from "../../state/providers";
import { serverEnvironment } from "../../state/server";

const EMPTY_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null).pipe(
  Atom.withLabel("nondev-usage-providers:empty"),
);

/**
 * The providers of the first environment and the one a new conversation starts with: the same
 * provider the "Using …" pill names. Limits ride on the provider snapshots the server config
 * stream already pushes (a probe, then sparse updates as turns report rate limits), so reading
 * them costs nothing extra.
 */
export function useActiveUsage(): {
  readonly environmentId: EnvironmentId | null;
  readonly providers: ReadonlyArray<ServerProvider> | null;
  readonly active: ServerProvider | null;
} {
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const providers = useAtomValue(
    environmentId === null
      ? EMPTY_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  const active = providerForSelection(providers, resolveDefaultModelSelection(providers, null));
  return { environmentId, providers, active };
}

/**
 * A gentle re-check of every provider's limits, for when the popover or the sheet opens. It
 * shares the stock Usage page's per-environment throttle (one probe per five minutes, and
 * never two at once), so hovering back and forth costs nothing.
 */
export function useGentleUsageRefresh(environmentId: EnvironmentId | null): () => void {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  return () => {
    if (environmentId === null) return;
    void refreshUsageLimits(
      environmentId,
      () => refreshProviders({ environmentId, input: {} }),
      true,
    );
  };
}

/** The person's own zone, for "resets 3:40 pm". */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// One Usage sheet for the window: the ring, the popover's link and the banner's "Details" all
// open the same one, rendered once by UsageSheetHost.
let sheetOpen = false;
const listeners = new Set<() => void>();

function setSheetOpen(open: boolean): void {
  if (sheetOpen === open) return;
  sheetOpen = open;
  for (const listener of listeners) listener();
}

export const openUsageSheet = (): void => setSheetOpen(true);
export const closeUsageSheet = (): void => setSheetOpen(false);

export function useUsageSheetOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sheetOpen,
  );
}
