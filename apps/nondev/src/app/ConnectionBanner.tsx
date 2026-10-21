import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { environmentPresentations } from "../state/server";
import { Banner } from "../ui/Banner";

/**
 * Calm connection status, never a raw error. Hidden while connected; shows
 * "Can't reach your Mac. Trying again…" while the engine is away.
 */
export function ConnectionBanner() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  if (!catalog.isReady) return <div />;
  if (environmentIds.length === 0) {
    return (
      <Banner tone="offline">
        <b>Looking for your Mac…</b> The engine that served this page should appear in a moment.
      </Banner>
    );
  }
  return <EnvironmentBanner environmentId={environmentIds[0]!} />;
}

function EnvironmentBanner({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const presentation = useAtomValue(environmentPresentations.presentationAtom(environmentId));
  const phase = presentation?.connection.phase ?? "connecting";
  switch (phase) {
    case "connected":
      return <div />;
    case "connecting":
    case "reconnecting":
      return (
        <Banner tone="offline">
          <b>Can't reach your Mac.</b> Trying again…
        </Banner>
      );
    default:
      return (
        <Banner tone="offline">
          <b>Not connected to your Mac.</b> Check it is awake and on the same network, then reload.
        </Banner>
      );
  }
}
