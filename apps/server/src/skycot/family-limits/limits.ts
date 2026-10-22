// The Family profile's limits, pure part: one child's day (minutes, messages, a grown-up's
// extra time), and whether SKYCOT is awake for them right now. The engine enforces this at
// turn start (SkycotFamilyGate); the client shows what it says.
//
// How time is counted (docs/nondev/FAMILY.md says the same in plain words):
// - A minute counts once per child, on the engine's clock: several tabs or devices in the same
//   minute still make one minute, and a gap is never filled in afterwards.
// - It counts when the child starts a turn, and when SKYCOT is on screen and the child has
//   touched or typed in the last couple of minutes (the client's heartbeat says so twice a
//   minute). The assistant working while nobody is looking does not count.
// - "Today" is the household's calendar day; it starts again at local midnight.
// The shared bedtime helpers (packages/skycot-brand, also used by the browser) speak `Date`.
// @effect-diagnostics globalDate:off
import {
  bedtimeAt,
  localDay,
  nextLocalMidnight,
  type BedtimeAt,
} from "@t3tools/skycot-brand/bedtime";
import type { ServerProvider } from "@t3tools/contracts";

import type { ChildLimits } from "../SkycotFamily.ts";

const MINUTE = 60_000;
/** The heads-up shows this many minutes before SKYCOT goes to sleep. */
export const HEADS_UP_MINUTES = 5;

export interface ChildDay {
  /** The local day these counters are for ("2026-10-22"). */
  readonly date: string;
  readonly minutes: number;
  /** The last counted minute, as minutes since the epoch, so a minute never counts twice. */
  readonly lastMinute: number | null;
  readonly turns: number;
  /** A grown-up's extra time: SKYCOT stays awake for this child until then, whatever the limits. */
  readonly passUntil: number | null;
  /** A grown-up ended bedtime early: the bedtime window ending at this instant is skipped. */
  readonly bedtimeSkippedUntil: number | null;
}

export function freshDay(date: string): ChildDay {
  return {
    date,
    minutes: 0,
    lastMinute: null,
    turns: 0,
    passUntil: null,
    bedtimeSkippedUntil: null,
  };
}

/** The day `now` falls in. A new day starts the counters again; a grown-up's yes still running carries over. */
export function dayAt(day: ChildDay | undefined, now: number, timeZone: string): ChildDay {
  const date = localDay(new Date(now), timeZone);
  if (day !== undefined && day.date === date) return day;
  const fresh = freshDay(date);
  return {
    ...fresh,
    passUntil: day?.passUntil !== null && (day?.passUntil ?? 0) > now ? day!.passUntil : null,
    bedtimeSkippedUntil:
      day?.bedtimeSkippedUntil !== null && (day?.bedtimeSkippedUntil ?? 0) > now
        ? day!.bedtimeSkippedUntil
        : null,
  };
}

/** Counts the minute `now` is in, once. A clock moved back counts nothing until it catches up. */
export function countMinute(day: ChildDay | undefined, now: number, timeZone: string): ChildDay {
  const current = dayAt(day, now, timeZone);
  const minute = Math.floor(now / MINUTE);
  if (current.lastMinute !== null && minute <= current.lastMinute) return current;
  return { ...current, minutes: current.minutes + 1, lastMinute: minute };
}

export function countTurn(day: ChildDay | undefined, now: number, timeZone: string): ChildDay {
  const counted = countMinute(day, now, timeZone);
  return { ...counted, turns: counted.turns + 1 };
}

export type LimitReason = "bedtime" | "time" | "turns" | "allowance";

/** The AI allowance as the provider reports it for the whole account. */
export interface AllowanceReading {
  /** "ChatGPT" */
  readonly brand: string;
  readonly leftPercent: number;
  readonly resetsAt: number | null;
}

export interface LimitState {
  readonly asleep: boolean;
  readonly reason: LimitReason | null;
  /**
   * Minutes until SKYCOT goes to sleep for this child (bedtime, the daily time running out, or
   * a grown-up's extra time ending); null when nothing is coming today.
   */
  readonly minutesLeft: number | null;
  readonly headsUp: boolean;
  /** When it wakes on its own (epoch ms); null while asleep with no known end. */
  readonly wakesAt: number | null;
  /** The next instant this can change on the wall clock alone, for the client's one timer. */
  readonly changesAt: number | null;
  readonly usedMinutes: number;
  readonly turns: number;
  readonly passUntil: number | null;
  readonly bedtime: {
    readonly inside: boolean;
    readonly startsAt: number;
    readonly endsAt: number;
  } | null;
  readonly allowance: AllowanceReading | null;
}

const minutesUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / MINUTE));

function bedtimeWindow(limits: ChildLimits, now: number, timeZone: string): BedtimeAt | null {
  return limits.bedtime === null ? null : bedtimeAt(new Date(now), timeZone, limits.bedtime);
}

const skips = (day: ChildDay, window: BedtimeAt) =>
  day.bedtimeSkippedUntil !== null && day.bedtimeSkippedUntil >= window.endsAt.getTime();

/** When a child stopped by a daily limit wakes: tomorrow, or after tomorrow's bedtime if one covers midnight. */
function nextMorning(limits: ChildLimits, now: number, timeZone: string): number {
  const midnight = nextLocalMidnight(new Date(now), timeZone);
  const window = bedtimeWindow(limits, midnight.getTime(), timeZone);
  return window?.inside ? window.endsAt.getTime() : midnight.getTime();
}

export function evaluateLimits(input: {
  readonly limits: ChildLimits;
  readonly day: ChildDay | undefined;
  readonly now: number;
  readonly timeZone: string;
  readonly allowance: AllowanceReading | null;
}): LimitState {
  const { limits, now, timeZone } = input;
  const day = dayAt(input.day, now, timeZone);
  const window = bedtimeWindow(limits, now, timeZone);
  const inBedtime = window !== null && window.inside && !skips(day, window);
  const timeUp = limits.dailyMinutes !== null && day.minutes >= limits.dailyMinutes;
  const turnsUp = limits.dailyTurns !== null && day.turns >= limits.dailyTurns;
  const allowance = limits.keepAllowancePercent === null ? null : input.allowance;
  const allowanceLow =
    allowance !== null &&
    limits.keepAllowancePercent !== null &&
    allowance.leftPercent <= limits.keepAllowancePercent;
  const limited: LimitReason | null = inBedtime
    ? "bedtime"
    : timeUp
      ? "time"
      : turnsUp
        ? "turns"
        : allowanceLow
          ? "allowance"
          : null;
  const pass = day.passUntil !== null && day.passUntil > now ? day.passUntil : null;
  const asleep = limited !== null && pass === null;

  let minutesLeft: number | null = null;
  if (limited !== null && pass !== null) {
    minutesLeft = minutesUntil(pass, now);
  } else if (!asleep) {
    const candidates: number[] = [];
    if (window !== null && !window.inside && !skips(day, window)) {
      candidates.push(minutesUntil(window.startsAt.getTime(), now));
    }
    if (limits.dailyMinutes !== null) candidates.push(limits.dailyMinutes - day.minutes);
    minutesLeft = candidates.length === 0 ? null : Math.max(0, Math.min(...candidates));
    if (minutesLeft !== null && pass !== null)
      minutesLeft = Math.max(minutesLeft, minutesUntil(pass, now));
  }

  let wakesAt: number | null = null;
  if (asleep) {
    wakesAt =
      limited === "bedtime"
        ? window!.endsAt.getTime()
        : limited === "allowance"
          ? (allowance?.resetsAt ?? null)
          : nextMorning(limits, now, timeZone);
  }

  const changes = [
    window === null ? null : window.inside ? window.endsAt.getTime() : window.startsAt.getTime(),
    pass,
    nextLocalMidnight(new Date(now), timeZone).getTime(),
  ].filter((at): at is number => at !== null && at > now);

  return {
    asleep,
    reason: asleep ? limited : null,
    minutesLeft,
    headsUp: !asleep && minutesLeft !== null && minutesLeft <= HEADS_UP_MINUTES,
    wakesAt,
    changesAt: changes.length === 0 ? null : Math.min(...changes),
    usedMinutes: day.minutes,
    turns: day.turns,
    passUntil: pass,
    bedtime:
      window === null
        ? null
        : {
            inside: inBedtime,
            startsAt: window.startsAt.getTime(),
            endsAt: window.endsAt.getTime(),
          },
    allowance,
  };
}

/** What a grown-up's "more time" does to the day. */
export type MoreTime =
  | { readonly type: "extra"; readonly minutes: 15 | 30 }
  | { readonly type: "endBedtime" };

export function applyMoreTime(
  day: ChildDay | undefined,
  limits: ChildLimits,
  more: MoreTime,
  now: number,
  timeZone: string,
): ChildDay {
  const current = dayAt(day, now, timeZone);
  if (more.type === "extra") {
    // Extra time adds to a pass still running, so two "15 more" make half an hour.
    const from = Math.max(now, current.passUntil ?? 0);
    return { ...current, passUntil: from + more.minutes * MINUTE };
  }
  const window = bedtimeWindow(limits, now, timeZone);
  // Before bedtime, "end bedtime for today" means tonight's; during it, this one.
  return window === null ? current : { ...current, bedtimeSkippedUntil: window.endsAt.getTime() };
}

const DRIVER_BRANDS: Readonly<Record<string, string>> = {
  codex: "ChatGPT",
  claudeAgent: "Claude",
  antigravity: "Google",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

/**
 * The allowance window that runs out first, as the plain client's usage ring reads it
 * (apps/nondev plain/usage.ts `bindingWindow`): the least left among windows that have not
 * reset; Claude's per-model weekly windows and spend caps only when nothing else is reported;
 * Cursor's "overall" dropped when its two pools are both there.
 */
export function allowanceReading(
  provider: Pick<ServerProvider, "driver" | "auth" | "usageLimits">,
  now: number,
): AllowanceReading | null {
  const limits = provider.usageLimits;
  if (
    provider.auth.status === "unauthenticated" ||
    limits === undefined ||
    limits.unavailable !== undefined
  ) {
    return null;
  }
  const driver = String(provider.driver);
  const ids = new Set(limits.windows.map((window) => window.id));
  const windows = limits.windows
    .filter(
      (window) =>
        !(
          driver === "cursor" &&
          window.id === "totalPercentUsed" &&
          ids.has("autoPercentUsed") &&
          ids.has("apiPercentUsed")
        ),
    )
    .map((window) => {
      const parsed = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
      return {
        leftPercent: Math.round(100 - Math.max(0, Math.min(100, window.usedPercent))),
        resetsAt: Number.isFinite(parsed) ? parsed : null,
        decides: !(
          driver === "claudeAgent" &&
          (window.id.startsWith("seven_day_") || window.id === "monthly_spend")
        ),
      };
    })
    .filter((window) => window.resetsAt === null || window.resetsAt >= now);
  const deciding = windows.some((window) => window.decides)
    ? windows.filter((window) => window.decides)
    : windows;
  let best: (typeof deciding)[number] | null = null;
  for (const window of deciding) {
    if (
      best === null ||
      window.leftPercent < best.leftPercent ||
      (window.leftPercent === best.leftPercent &&
        (window.resetsAt ?? Number.POSITIVE_INFINITY) > (best.resetsAt ?? Number.POSITIVE_INFINITY))
    ) {
      best = window;
    }
  }
  return best === null
    ? null
    : {
        brand: DRIVER_BRANDS[driver] ?? driver,
        leftPercent: best.leftPercent,
        resetsAt: best.resetsAt,
      };
}
