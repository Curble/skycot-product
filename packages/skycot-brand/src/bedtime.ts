/**
 * Bedtime windows and "today" on a household's own clock, for the Family profile's limits. The
 * engine enforces them and the client shows them, so both read the same rules from here. Pure:
 * every function takes the instant and the IANA time zone; nothing reads the clock itself.
 */
import { wallClock, zonedTime } from "./daylight.ts";

/** "19:30" → minutes after midnight (1170); null for anything that is not a 24-hour time. */
export function parseClockTime(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 1170 → "19:30". */
export function formatClockTime(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** The zone itself when the runtime knows it, else UTC (a stored zone may come from another machine). */
export function knownTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/** The local calendar day, "2026-10-22", in `timeZone`. */
export function localDay(at: Date, timeZone: string): string {
  const clock = wallClock(at, knownTimeZone(timeZone));
  return `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

/** The instant the next local day starts (next midnight), in `timeZone`. */
export function nextLocalMidnight(at: Date, timeZone: string): Date {
  const zone = knownTimeZone(timeZone);
  const clock = wallClock(at, zone);
  return zonedTime(clock.year, clock.month, clock.day + 1, 0, 0, zone);
}

export interface BedtimeWindow {
  /** "19:30" */
  readonly start: string;
  /** "07:00"; earlier than `start` means the window runs past midnight. */
  readonly end: string;
}

export interface BedtimeAt {
  /** Whether `at` is inside a bedtime window. */
  readonly inside: boolean;
  /** The window `at` is in, or the next one when it is outside. */
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Where `at` stands against a daily bedtime window in `timeZone`. Times are wall-clock, so a
 * daylight-saving change moves the instants, not the hours. A window whose start and end are
 * the same is no window (null), as is one that does not parse.
 */
export function bedtimeAt(at: Date, timeZone: string, window: BedtimeWindow): BedtimeAt | null {
  const start = parseClockTime(window.start);
  const end = parseClockTime(window.end);
  if (start === null || end === null || start === end) return null;
  const zone = knownTimeZone(timeZone);
  const clock = wallClock(at, zone);
  const minute = clock.hour * 60 + clock.minute;
  const on = (dayOffset: number, minutes: number) =>
    zonedTime(
      clock.year,
      clock.month,
      clock.day + dayOffset,
      Math.floor(minutes / 60),
      minutes % 60,
      zone,
    );
  if (start > end) {
    // Past midnight (19:30–07:00): the evening part and the morning part are one window.
    if (minute >= start) return { inside: true, startsAt: on(0, start), endsAt: on(1, end) };
    if (minute < end) return { inside: true, startsAt: on(-1, start), endsAt: on(0, end) };
    return { inside: false, startsAt: on(0, start), endsAt: on(1, end) };
  }
  // Inside one day (13:00–15:00).
  if (minute >= start && minute < end) {
    return { inside: true, startsAt: on(0, start), endsAt: on(0, end) };
  }
  const dayOffset = minute < start ? 0 : 1;
  return { inside: false, startsAt: on(dayOffset, start), endsAt: on(dayOffset, end) };
}
