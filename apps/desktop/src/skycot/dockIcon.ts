/**
 * SKYCOT: the running Dock icon follows the sky. Day drawing from local civil dawn to civil dusk,
 * dusk drawing (twilight + star) from dusk to dawn, switched by one timer armed for the next
 * change (packages/skycot-brand, the same clock the client's mascot uses) and re-read when the
 * Mac wakes. The installed icon in Finder stays the day drawing (brand guide, section 2).
 *
 * The Dock always follows the sky; Settings → Appearance → Mascot only pins the in-app mascot.
 * That choice lives in the renderer's local storage, and reading it here would need a new IPC
 * channel through upstream's preload for a cosmetic preference. Wired in by the
 * `brand-dock-icon` seam in app/DesktopApp.ts; macOS only (Windows and Linux have no runtime
 * Dock tile to swap).
 */
import { createDaylightClock, type DaylightClockOptions } from "@t3tools/skycot-brand/schedule";
import type { SkyPhase } from "@t3tools/skycot-brand/daylight";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Electron from "electron";

import { DOCK_ICON_DAY_PNG_BASE64, DOCK_ICON_DUSK_PNG_BASE64 } from "./dockIcons.generated.ts";

export interface DockIconSwitcherOptions extends DaylightClockOptions {
  readonly setIcon: (phase: SkyPhase) => void;
  /** Called with a callback to run when the machine wakes; returns the unsubscribe. */
  readonly onWake: (listener: () => void) => () => void;
}

/** Sets the icon now and on every flip; returns a stop function. */
export function startDockIconSwitcher(options: DockIconSwitcherOptions): () => void {
  const clock = createDaylightClock(options);
  options.setIcon(clock.phase());
  const unsubscribe = clock.subscribe(options.setIcon);
  const offWake = options.onWake(() => clock.refresh());
  return () => {
    offWake();
    unsubscribe();
    clock.stop();
  };
}

function electronOptions(): DockIconSwitcherOptions {
  const images = new Map<SkyPhase, Electron.NativeImage>();
  const imageFor = (phase: SkyPhase) => {
    let image = images.get(phase);
    if (!image) {
      const base64 = phase === "dusk" ? DOCK_ICON_DUSK_PNG_BASE64 : DOCK_ICON_DAY_PNG_BASE64;
      image = Electron.nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
      images.set(phase, image);
    }
    return image;
  };
  return {
    // @effect-diagnostics-next-line globalDate:off - the shared clock is plain TypeScript, also used in the browser.
    now: () => new Date(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    // @effect-diagnostics-next-line globalTimers:off - one timer to the next dawn or dusk, cleared on scope close.
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setIcon: (phase) => Electron.app.dock?.setIcon(imageFor(phase)),
    onWake: (listener) => {
      Electron.powerMonitor.on("resume", listener);
      return () => Electron.powerMonitor.off("resume", listener);
    },
  };
}

/** Starts the switcher for the life of the surrounding scope. Call after `app.whenReady()`. */
export const followTheSky = Effect.gen(function* () {
  if ((yield* HostProcess.Platform) !== "darwin") return;
  yield* Effect.acquireRelease(
    Effect.sync(() => startDockIconSwitcher(electronOptions())),
    (stop) => Effect.sync(stop),
  );
}).pipe(Effect.withSpan("skycot.dockIcon.followTheSky"));
