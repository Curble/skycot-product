// @effect-diagnostics globalDate:off - a hand-driven clock for the plain-TypeScript daylight scheduler.
import { describe, expect, it, vi } from "vite-plus/test";

import type { SkyPhase } from "@t3tools/skycot-brand/daylight";

vi.mock("electron", () => ({}));

import { startDockIconSwitcher } from "./dockIcon.ts";

/** Time moves only when the test says so; timers and wake listeners are visible lists. */
function harness(startIso: string) {
  let now = new Date(startIso).getTime();
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
  const wakeListeners = new Set<() => void>();
  const icons: SkyPhase[] = [];
  let nextId = 1;
  return {
    icons,
    timers,
    wakeListeners,
    options: {
      now: () => new Date(now),
      timeZone: () => "Australia/Melbourne",
      setTimer: (callback: () => void, delayMs: number) => {
        const id = nextId++;
        timers.set(id, { at: now + delayMs, callback });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
      setIcon: (phase: SkyPhase) => {
        icons.push(phase);
      },
      onWake: (listener: () => void) => {
        wakeListeners.add(listener);
        return () => wakeListeners.delete(listener);
      },
    },
    fireNext: () => {
      const [id, timer] = [...timers.entries()].sort(([, a], [, b]) => a.at - b.at)[0]!;
      timers.delete(id);
      now = Math.max(now, timer.at);
      timer.callback();
    },
    sleepFor: (ms: number) => {
      now += ms;
    },
    wake: () => {
      for (const listener of wakeListeners) listener();
    },
  };
}

describe("startDockIconSwitcher", () => {
  it("shows the day icon at noon and the dusk icon when the dusk timer fires", () => {
    const mac = harness("2026-10-22T12:00:00+11:00");
    startDockIconSwitcher(mac.options);
    expect(mac.icons).toEqual(["day"]);
    expect(mac.timers.size).toBe(1);

    mac.fireNext(); // civil dusk, about 20:11 in Melbourne
    expect(mac.icons).toEqual(["day", "dusk"]);
    expect(mac.timers.size).toBe(1);

    mac.fireNext(); // civil dawn
    expect(mac.icons).toEqual(["day", "dusk", "day"]);
  });

  it("catches up on wake when the Mac slept through dusk", () => {
    const mac = harness("2026-10-22T12:00:00+11:00");
    startDockIconSwitcher(mac.options);
    mac.sleepFor(10 * 3_600_000);
    mac.wake();
    expect(mac.icons).toEqual(["day", "dusk"]);
    expect(mac.timers.size).toBe(1);
  });

  it("starts on the dusk icon at night", () => {
    const mac = harness("2026-10-22T23:00:00+11:00");
    startDockIconSwitcher(mac.options);
    expect(mac.icons).toEqual(["dusk"]);
  });

  it("stop removes the timer and the wake listener", () => {
    const mac = harness("2026-10-22T12:00:00+11:00");
    const stop = startDockIconSwitcher(mac.options);
    stop();
    expect(mac.timers.size).toBe(0);
    expect(mac.wakeListeners.size).toBe(0);
  });
});
