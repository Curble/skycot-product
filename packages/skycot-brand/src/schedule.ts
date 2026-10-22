/**
 * One timer to the next civil dawn or dusk, never a poll. The browser hook and the Electron Dock
 * switcher both run on this; each injects its own clock and timer so tests drive it by hand.
 */
import { phaseAt, type SkyPhase } from "./daylight.ts";

/** setTimeout's ceiling (about 24.8 days); a longer wait (polar night) re-arms when it fires. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/** Timers can fire a hair early; landing just after the boundary means the new phase is read. */
const BOUNDARY_SLACK_MS = 1_000;

export interface DaylightClockOptions {
  readonly now: () => Date;
  /** Read on every evaluation, so a laptop that changes time zone is followed on the next refresh. */
  readonly timeZone: () => string;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface DaylightClock {
  readonly phase: () => SkyPhase;
  /** Re-read the clock and re-arm the timer: after sleep, on focus, or when the tab is shown again. */
  readonly refresh: () => void;
  readonly subscribe: (listener: (phase: SkyPhase) => void) => () => void;
  readonly stop: () => void;
}

export function createDaylightClock(options: DaylightClockOptions): DaylightClock {
  const listeners = new Set<(phase: SkyPhase) => void>();
  let handle: unknown = null;
  let stopped = false;
  let current: SkyPhase = "day";

  const evaluate = () => {
    if (handle !== null) options.clearTimer(handle);
    handle = null;
    if (stopped) return;
    const now = options.now();
    const next = phaseAt(now, options.timeZone());
    const changed = next.phase !== current;
    current = next.phase;
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, next.nextChange.getTime() - now.getTime()) + BOUNDARY_SLACK_MS,
    );
    handle = options.setTimer(evaluate, delay);
    if (changed) for (const listener of listeners) listener(current);
  };

  // No listener exists yet, so the first evaluation only sets the phase and arms the timer.
  evaluate();

  return {
    phase: () => current,
    refresh: evaluate,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      stopped = true;
      if (handle !== null) options.clearTimer(handle);
      handle = null;
      listeners.clear();
    },
  };
}
