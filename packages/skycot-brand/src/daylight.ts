/**
 * Day or dusk, from the sky over the person's time zone.
 *
 * The brand rule (docs/brand/SKYCOT-brand-guide.html, "The time-of-day rule"): the mascot is the
 * DAY drawing from local civil dawn to civil dusk and the DUSK drawing from civil dusk to dawn.
 * Civil twilight is the moment the sun's centre is 6° below the horizon (zenith 96°).
 *
 * Sun position follows the NOAA solar calculator equations (Meeus, "Astronomical Algorithms"):
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html — accurate to about a minute for the
 * latitudes people live at. No location is asked for: the time zone's main city stands in
 * (zones.generated.ts). Pure and DOM-free so the browser client and the Electron main process
 * share it.
 */
import { ZONE_ALIASES, ZONE_COORDINATES } from "./zones.generated.ts";

export type SkyPhase = "day" | "dusk";

export interface Coordinates {
  /** Degrees, north positive. */
  readonly latitude: number;
  /** Degrees, east positive. */
  readonly longitude: number;
}

export interface PhaseAt {
  readonly phase: SkyPhase;
  /** The next instant the phase flips. Always after the date asked about. */
  readonly nextChange: Date;
}

const DAY_MS = 86_400_000;
const CIVIL_ZENITH = 96;
/** Far enough to cross a polar night or polar summer (about six months at the poles). */
const SEARCH_DAYS = 370;

/** Used when a time zone has no known city: day from 06:30 to 19:00 local time. */
export const FALLBACK_DAY_START_MINUTES = 6 * 60 + 30;
export const FALLBACK_DUSK_START_MINUTES = 19 * 60;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

interface SunAt {
  /** Minutes. */
  readonly equationOfTime: number;
  /** Degrees. */
  readonly declination: number;
}

/** NOAA: sun's declination and the equation of time at a Julian date. */
function sunAt(julianDate: number): SunAt {
  const t = (julianDate - 2451545) / 36525;
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = rad(meanAnomaly);
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = rad(125.04 - 1934.136 * t);
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega);
  const declination = deg(Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLongitude))));
  const y = Math.tan(rad(obliquity) / 2) ** 2;
  const l0 = rad(meanLongitude);
  const equation =
    y * Math.sin(2 * l0) -
    2 * eccentricity * Math.sin(m) +
    4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
    0.5 * y * y * Math.sin(4 * l0) -
    1.25 * eccentricity * eccentricity * Math.sin(2 * m);
  return { equationOfTime: deg(equation) * 4, declination };
}

/**
 * Minutes after 00:00 UTC of `utcDay` at which the sun crosses the civil zenith, or null when it
 * never does that day (polar night or a summer night that never gets dark enough).
 */
function crossingMinutes(utcDay: number, at: Coordinates, rising: boolean): number | null {
  const midnightJulian = utcDay + 2440587.5;
  const estimate = (minutes: number): number | null => {
    const sun = sunAt(midnightJulian + minutes / 1440);
    const lat = rad(at.latitude);
    const dec = rad(sun.declination);
    const cosHourAngle =
      Math.cos(rad(CIVIL_ZENITH)) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec);
    if (cosHourAngle > 1 || cosHourAngle < -1) return null;
    const hourAngle = deg(Math.acos(cosHourAngle)) * (rising ? 1 : -1);
    return 720 - 4 * (at.longitude + hourAngle) - sun.equationOfTime;
  };
  // Start from local solar noon, then refine at the estimate (NOAA does the same second pass).
  const first = estimate(720 - 4 * at.longitude);
  return first === null ? null : estimate(first);
}

interface Transition {
  readonly at: number;
  readonly to: SkyPhase;
}

/** Civil dawn and dusk around the solar noon that falls on this UTC day, in time order. */
function transitionsOn(utcDay: number, at: Coordinates): Transition[] {
  const out: Transition[] = [];
  const dawn = crossingMinutes(utcDay, at, true);
  const dusk = crossingMinutes(utcDay, at, false);
  // Whole milliseconds, as a Date holds them, so a reported `nextChange` compares equal later.
  if (dawn !== null) out.push({ at: Math.round(utcDay * DAY_MS + dawn * 60_000), to: "day" });
  if (dusk !== null) out.push({ at: Math.round(utcDay * DAY_MS + dusk * 60_000), to: "dusk" });
  return out.sort((a, b) => a.at - b.at);
}

/** Civil dawn and dusk for the solar day centred on this UTC date (`Date.UTC(y, m, d)`). */
export function civilTwilight(
  utcMidnight: Date,
  at: Coordinates,
): { readonly dawn: Date | null; readonly dusk: Date | null } {
  const utcDay = Math.floor(utcMidnight.getTime() / DAY_MS);
  const dawn = crossingMinutes(utcDay, at, true);
  const dusk = crossingMinutes(utcDay, at, false);
  return {
    dawn: dawn === null ? null : new Date(utcDay * DAY_MS + dawn * 60_000),
    dusk: dusk === null ? null : new Date(utcDay * DAY_MS + dusk * 60_000),
  };
}

/** The sun's elevation above the horizon at an instant, degrees (NOAA, no refraction). */
export function solarElevation(date: Date, at: Coordinates): number {
  const ms = date.getTime();
  const sun = sunAt(ms / DAY_MS + 2440587.5);
  const minutesUtc = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  const trueSolarTime =
    (((minutesUtc + sun.equationOfTime + 4 * at.longitude) % 1440) + 1440) % 1440;
  const hourAngle = rad(trueSolarTime / 4 - 180);
  const lat = rad(at.latitude);
  const dec = rad(sun.declination);
  const cosZenith =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return 90 - deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
}

/** Within this distance of a computed dawn or dusk, the event order decides, not the elevation. */
const NEAR_TRANSITION_MS = 10 * 60_000;

/**
 * Day while the sun is above -6°. Polar summer (no civil dusk) stays day and polar night stays
 * dusk with no special case, which is the brand guide's polar rule. Right next to a computed dawn
 * or dusk the event itself decides, so the phase flips exactly at the `nextChange` it reported
 * even though elevation and crossing times are separate approximations.
 */
export function phaseAtLocation(date: Date, at: Coordinates): PhaseAt {
  const t = date.getTime();
  const today = Math.floor(t / DAY_MS);
  const nearby = [today - 1, today, today + 1].flatMap((day) => transitionsOn(day, at));
  const previous = nearby.findLast((transition) => transition.at <= t);
  const upcoming = nearby.find((transition) => transition.at > t);
  const phase: SkyPhase =
    previous && t - previous.at < NEAR_TRANSITION_MS
      ? previous.to
      : upcoming && upcoming.at - t < NEAR_TRANSITION_MS
        ? upcoming.to === "day"
          ? "dusk"
          : "day"
        : solarElevation(date, at) > 90 - CIVIL_ZENITH
          ? "day"
          : "dusk";
  let next: Transition | undefined;
  for (let day = today - 1; day <= today + SEARCH_DAYS && next === undefined; day++) {
    next = transitionsOn(day, at).find(
      (transition) => transition.at > t && transition.to !== phase,
    );
  }
  return { phase, nextChange: new Date(next?.at ?? t + SEARCH_DAYS * DAY_MS) };
}

/** The coordinates standing in for a time zone, or null when it names no place (UTC, Etc/GMT+5). */
export function coordinatesForTimeZone(timeZone: string): Coordinates | null {
  const lookup = (name: string): Coordinates | null => {
    const hit = ZONE_COORDINATES[name] ?? ZONE_COORDINATES[ZONE_ALIASES[name] ?? ""];
    return hit ? { latitude: hit[0], longitude: hit[1] } : null;
  };
  const direct = lookup(timeZone);
  if (direct) return direct;
  // Engines canonicalise differently (ICU still says Asia/Calcutta); ask this one for its name.
  const canonical = resolvedZoneName(timeZone);
  return canonical && canonical !== timeZone ? lookup(canonical) : null;
}

/** Day from 06:30 to 19:00 on the zone's wall clock; DST-correct through `zonedTime`. */
function fallbackPhase(date: Date, timeZone: string): PhaseAt {
  const local = wallClock(date, timeZone);
  const minutes = local.hour * 60 + local.minute;
  const at = (dayOffset: number, minuteOfDay: number) =>
    zonedTime(
      local.year,
      local.month,
      local.day + dayOffset,
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
      timeZone,
    );
  if (minutes < FALLBACK_DAY_START_MINUTES)
    return { phase: "dusk", nextChange: at(0, FALLBACK_DAY_START_MINUTES) };
  if (minutes < FALLBACK_DUSK_START_MINUTES)
    return { phase: "day", nextChange: at(0, FALLBACK_DUSK_START_MINUTES) };
  return { phase: "dusk", nextChange: at(1, FALLBACK_DAY_START_MINUTES) };
}

/**
 * Day or dusk at `date` for someone whose device is set to `timeZone` (an IANA name such as
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`), and when it next changes.
 */
export function phaseAt(date: Date, timeZone: string): PhaseAt {
  const coordinates = coordinatesForTimeZone(timeZone);
  if (coordinates) return phaseAtLocation(date, coordinates);
  return fallbackPhase(date, resolvedZoneName(timeZone) ?? "UTC");
}

// Wall-clock helpers (Intl only; no tz library).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The engine's own name for a zone, or null when it does not know the zone at all. */
function resolvedZoneName(timeZone: string): string | null {
  try {
    return formatterFor(timeZone).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function wallClock(date: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

function offsetMs(instant: number, timeZone: string): number {
  const local = wallClock(new Date(instant), timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time happens in `timeZone` (out-of-range days roll over). */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return new Date(second);
}
