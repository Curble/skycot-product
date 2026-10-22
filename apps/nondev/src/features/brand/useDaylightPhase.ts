// The browser's day/dusk clock: one shared timer to the next civil dawn or dusk (no polling),
// re-read when the window is shown or focused again (a laptop waking from sleep, a tab the
// browser froze), torn down when nothing is listening.
import { createDaylightClock, type DaylightClock } from "@t3tools/skycot-brand/schedule";
import { useSyncExternalStore } from "react";

import faviconDayUrl from "../../assets/brand/favicon-day.svg";
import faviconDuskUrl from "../../assets/brand/favicon-dusk.svg";
import { deviceTimeZone, mascotPhase, phaseAt, type SkyPhase } from "../../plain/daylight";
import { readMascotOverride, subscribeLocalPrefs, useMascotOverride } from "../settings/localPrefs";

const listeners = new Set<() => void>();
let clock: DaylightClock | null = null;
let stopClock: (() => void) | null = null;

function start(): DaylightClock {
  const daylight = createDaylightClock({
    now: () => new Date(),
    timeZone: deviceTimeZone,
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  const onVisible = () => {
    if (document.visibilityState === "visible") daylight.refresh();
  };
  const onFocus = () => daylight.refresh();
  const unsubscribe = daylight.subscribe(() => {
    for (const listener of listeners) listener();
  });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  stopClock = () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onFocus);
    daylight.stop();
  };
  return daylight;
}

function subscribeSky(listener: () => void) {
  listeners.add(listener);
  clock ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopClock?.();
      stopClock = null;
      clock = null;
    }
  };
}

function readSky(): SkyPhase {
  return clock?.phase() ?? phaseAt(new Date(), deviceTimeZone()).phase;
}

/** The sky's phase where this device is, ignoring the Settings override. */
export function useSkyPhase(): SkyPhase {
  return useSyncExternalStore(subscribeSky, readSky, () => "day");
}

/** Which mascot drawing to show now: the sky's phase, or the drawing Settings pins. */
export function useDaylightPhase(): SkyPhase {
  return mascotPhase(useSkyPhase(), useMascotOverride());
}

/**
 * Keeps the tab icon and `html[data-skycot-time]` (the brand tokens' dusk switch) on the current
 * drawing for the life of the page. Started once from main.tsx.
 */
export function startDaylightBranding() {
  const apply = () => {
    const phase = mascotPhase(readSky(), readMascotOverride());
    document.documentElement.dataset.skycotTime = phase;
    const href = phase === "dusk" ? faviconDuskUrl : faviconDayUrl;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    if (link.getAttribute("href") !== href) link.href = href;
  };
  subscribeSky(apply);
  subscribeLocalPrefs(apply);
  apply();
}
