import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { requestReconnect } from "../connection/platform";
import { ENGINE_PROBE_INTERVAL_MS, engineAnswers, shouldWake } from "./engineProbe";
import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { environmentPresentations } from "../state/server";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { useChildView } from "./useChildView";

/**
 * Calm connection status, never a raw error. Hidden while connected. The copy
 * only ever asks for a reload when the app has genuinely stopped retrying;
 * while it retries on its own it says so and offers to try at once.
 *
 * Connecting is normal on every load and after a short blip, so the "can't
 * reach" wording waits CONNECTION_GRACE_MS before it shows: a child should
 * never read "SKYCOT can't wake up" while the page is simply starting.
 */
export const CONNECTION_GRACE_MS = 6000;

/** Phases that are part of a normal (re)connect and get the grace period. */
export function isGracePhase(phase: string): boolean {
  return phase === "connecting" || phase === "reconnecting" || phase === "available";
}

/** True once the app has been waiting longer than the grace period. */
export function waitedPastGrace(waitingSinceMs: number, nowMs: number): boolean {
  return nowMs - waitingSinceMs >= CONNECTION_GRACE_MS;
}

/** Becomes true CONNECTION_GRACE_MS after `waiting` turns true; resets when it turns false. */
function useWaitedPastGrace(waiting: boolean): boolean {
  const [since, setSince] = useState<number | null>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setSince(null);
      setPast(false);
      return;
    }
    const start = since ?? Date.now();
    if (since === null) setSince(start);
    const left = CONNECTION_GRACE_MS - (Date.now() - start);
    if (left <= 0) {
      setPast(true);
      return;
    }
    const timer = setTimeout(() => setPast(waitedPastGrace(start, Date.now())), left);
    return () => clearTimeout(timer);
  }, [waiting, since]);
  return waiting && past;
}

/** Module-wide so two banners (shell and picker) never send wakeups back to back. */
let lastWakeMs: number | null = null;

/**
 * While the banner is showing, ask the engine every few seconds and send the
 * "Try now" wakeup as soon as it answers, instead of waiting out the
 * connection layer's growing retry delay.
 */
function useWakeWhenEngineAnswers(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const timer = setInterval(() => {
      void engineAnswers().then((answered) => {
        const now = Date.now();
        if (stopped || !shouldWake(answered, lastWakeMs, now)) return;
        lastWakeMs = now;
        requestReconnect();
      });
    }, ENGINE_PROBE_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
}

export function ConnectionBanner({ childWording }: { readonly childWording?: boolean } = {}) {
  const ownChildView = useChildView();
  const childView = childWording ?? ownChildView;
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const noEnvironment = catalog.isReady && environmentIds.length === 0;
  const showNoEnvironment = useWaitedPastGrace(noEnvironment);
  if (!catalog.isReady) return <div />;
  if (environmentIds.length === 0) {
    if (!showNoEnvironment) return <div />;
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
  return <EnvironmentBanner environmentId={environmentIds[0]!} childView={childView} />;
}

function EnvironmentBanner({
  environmentId,
  childView,
}: {
  readonly environmentId: EnvironmentId;
  readonly childView: boolean;
}) {
  const presentation = useAtomValue(environmentPresentations.presentationAtom(environmentId));
  const phase = presentation?.connection.phase ?? "connecting";
  const showWaiting = useWaitedPastGrace(isGracePhase(phase));
  useWakeWhenEngineAnswers(showWaiting || phase === "error");
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
      if (!showWaiting) return <div />;
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
