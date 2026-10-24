import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { requestReconnect } from "../connection/platform";
import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { environmentPresentations } from "../state/server";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { useChildView } from "./useChildView";

/**
 * Calm connection status, never a raw error. Hidden while connected. The copy
 * only ever asks for a reload when the app has genuinely stopped retrying;
 * while it retries on its own it says so and offers to try at once.
 */
export function ConnectionBanner() {
  const childView = useChildView();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  if (!catalog.isReady) return <div />;
  if (environmentIds.length === 0) {
    return (
      <Banner tone="offline">
        {childView ? (
          <>
            <b>Can't reach your Mac.</b> Ask a grown-up to check the Mac is on.
          </>
        ) : (
          <>
            <b>Looking for your Mac…</b> The part of SKYCOT that runs there should appear in a
            moment.
          </>
        )}
      </Banner>
    );
  }
  return <EnvironmentBanner environmentId={environmentIds[0]!} />;
}

function EnvironmentBanner({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const childView = useChildView();
  const presentation = useAtomValue(environmentPresentations.presentationAtom(environmentId));
  const phase = presentation?.connection.phase ?? "connecting";
  const tryNow = (
    <Button size="sm" onClick={requestReconnect}>
      Try now
    </Button>
  );
  switch (phase) {
    case "connected":
      return <div />;
    case "offline":
      return (
        <Banner tone="offline">
          {childView ? (
            <>
              <b>SKYCOT can't wake up right now.</b> Ask a grown-up to check the Mac is on.
            </>
          ) : (
            <>
              <b>You're offline.</b> SKYCOT reconnects on its own when the network is back.
            </>
          )}
        </Banner>
      );
    case "connecting":
    case "reconnecting":
    case "available":
      return (
        <Banner tone="offline" action={tryNow}>
          {childView ? (
            <>
              <b>SKYCOT can't wake up right now.</b> Ask a grown-up to check the Mac is on.
            </>
          ) : (
            <>
              <b>Can't reach your Mac.</b> Trying again… Check it is awake and on the same network.
            </>
          )}
        </Banner>
      );
    case "error":
    case "unsupported":
      return (
        <Banner tone="offline" action={tryNow}>
          {childView ? (
            <>
              <b>SKYCOT can't wake up right now.</b> Ask a grown-up to check the Mac is on.
            </>
          ) : (
            <>
              <b>Not connected to your Mac.</b> Check it is awake and on the same network. If this
              stays, reload the page.
            </>
          )}
        </Banner>
      );
  }
}
