import { describe, expect, it } from "vite-plus/test";

import { phaseAt, type SkyPhase } from "./daylight.ts";
import { createDaylightClock, MAX_TIMER_DELAY_MS } from "./schedule.ts";

/** A hand-driven clock: time moves only when the test says so, and timers are a visible list. */
function fakeClock(startIso: string, zone = "Australia/Melbourne") {
  let now = new Date(startIso).getTime();
  let nextId = 1;
  const timers = new Map<number, { readonly at: number; readonly callback: () => void }>();
  let timeZone = zone;
  return {
    options: {
      now: () => new Date(now),
      timeZone: () => timeZone,
      setTimer: (callback: () => void, delayMs: number) => {
        const id = nextId++;
        timers.set(id, { at: now + delayMs, callback });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    timers,
    setTimeZone: (next: string) => {
      timeZone = next;
    },
    /** Jump the wall clock without firing anything (a laptop waking from sleep). */
    jump: (ms: number) => {
      now += ms;
    },
    /** Advance to the earliest timer and fire it. */
    fireNext: () => {
      const [id, timer] = [...timers.entries()].sort(([, a], [, b]) => a.at - b.at)[0]!;
      timers.delete(id);
      now = Math.max(now, timer.at);
      timer.callback();
    },
    nowMs: () => now,
  };
}

describe("createDaylightClock", () => {
  it("arms exactly one timer, just after the next civil dusk, and flips when it fires", () => {
    const clock = fakeClock("2026-10-22T12:00:00+11:00");
    const daylight = createDaylightClock(clock.options);
    const seen: SkyPhase[] = [];
    daylight.subscribe((phase) => seen.push(phase));

    expect(daylight.phase()).toBe("day");
    expect(clock.timers.size).toBe(1);
    const dusk = phaseAt(new Date(clock.nowMs()), "Australia/Melbourne").nextChange.getTime();
    const [timer] = [...clock.timers.values()];
    expect(timer!.at - dusk).toBeGreaterThan(0);
    expect(timer!.at - dusk).toBeLessThanOrEqual(1_000);

    clock.fireNext();
    expect(daylight.phase()).toBe("dusk");
    expect(seen).toEqual(["dusk"]);
    expect(clock.timers.size).toBe(1);

    clock.fireNext();
    expect(daylight.phase()).toBe("day");
    expect(seen).toEqual(["dusk", "day"]);
  });

  it("refresh after sleep catches up and still keeps a single timer", () => {
    const clock = fakeClock("2026-10-22T12:00:00+11:00");
    const daylight = createDaylightClock(clock.options);
    const seen: SkyPhase[] = [];
    daylight.subscribe((phase) => seen.push(phase));

    clock.jump(10 * 3_600_000); // 22:00, the dusk timer never got to run
    daylight.refresh();
    expect(daylight.phase()).toBe("dusk");
    expect(seen).toEqual(["dusk"]);
    expect(clock.timers.size).toBe(1);

    daylight.refresh();
    expect(seen).toEqual(["dusk"]);
    expect(clock.timers.size).toBe(1);
  });

  it("follows a time-zone change on refresh", () => {
    // 12:00 in Melbourne is 02:00 in London: day there, dusk here.
    const clock = fakeClock("2026-10-22T12:00:00+11:00");
    const daylight = createDaylightClock(clock.options);
    clock.setTimeZone("Europe/London");
    daylight.refresh();
    expect(daylight.phase()).toBe("dusk");
  });

  it("caps a polar-night wait at the timer ceiling and re-arms without flipping", () => {
    const clock = fakeClock("2026-12-21T12:00:00+01:00", "Arctic/Longyearbyen");
    const daylight = createDaylightClock(clock.options);
    const seen: SkyPhase[] = [];
    daylight.subscribe((phase) => seen.push(phase));
    const [timer] = [...clock.timers.values()];
    expect(timer!.at - clock.nowMs()).toBe(MAX_TIMER_DELAY_MS);

    clock.fireNext();
    expect(daylight.phase()).toBe("dusk");
    expect(seen).toEqual([]);
    expect(clock.timers.size).toBe(1);
  });

  it("stop clears the timer and silences listeners", () => {
    const clock = fakeClock("2026-10-22T12:00:00+11:00");
    const daylight = createDaylightClock(clock.options);
    const seen: SkyPhase[] = [];
    daylight.subscribe((phase) => seen.push(phase));
    daylight.stop();
    expect(clock.timers.size).toBe(0);
    daylight.refresh();
    expect(clock.timers.size).toBe(0);
    expect(seen).toEqual([]);
  });
});
