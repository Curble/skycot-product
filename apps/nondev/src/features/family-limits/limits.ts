// The Family limits as this client shows them: what the engine says about the child using
// SKYCOT on this device (asleep or awake, minutes left, the heads-up), and the plain words for
// it. The engine decides (apps/server/src/skycot/family-limits); nothing here can wake SKYCOT.
// Pure: callers pass the clock and the zone.
import type { ChildLimits } from "../family/children";

export type LimitReason = "bedtime" | "time" | "turns" | "allowance";

export interface LimitState {
  readonly asleep: boolean;
  readonly reason: LimitReason | null;
  readonly minutesLeft: number | null;
  readonly headsUp: boolean;
  readonly wakesAt: number | null;
  readonly changesAt: number | null;
  readonly usedMinutes: number;
  readonly turns: number;
  readonly passUntil: number | null;
  readonly bedtime: {
    readonly inside: boolean;
    readonly startsAt: number;
    readonly endsAt: number;
  } | null;
  readonly allowance: {
    readonly brand: string;
    readonly leftPercent: number;
    readonly resetsAt: number | null;
  } | null;
}

export interface SessionLimits {
  readonly childId: string | null;
  readonly needsChoice: boolean;
  readonly limits: LimitState | null;
  readonly sentence: string | null;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const REASONS: ReadonlySet<string> = new Set(["bedtime", "time", "turns", "allowance"]);

export function parseLimitState(value: unknown): LimitState | null {
  const input = record(value);
  if (typeof input["asleep"] !== "boolean") return null;
  const bedtime = record(input["bedtime"]);
  const allowance = record(input["allowance"]);
  return {
    asleep: input["asleep"],
    reason:
      typeof input["reason"] === "string" && REASONS.has(input["reason"])
        ? (input["reason"] as LimitReason)
        : null,
    minutesLeft: num(input["minutesLeft"]),
    headsUp: input["headsUp"] === true,
    wakesAt: num(input["wakesAt"]),
    changesAt: num(input["changesAt"]),
    usedMinutes: num(input["usedMinutes"]) ?? 0,
    turns: num(input["turns"]) ?? 0,
    passUntil: num(input["passUntil"]),
    bedtime:
      num(bedtime["startsAt"]) !== null && num(bedtime["endsAt"]) !== null
        ? {
            inside: bedtime["inside"] === true,
            startsAt: num(bedtime["startsAt"])!,
            endsAt: num(bedtime["endsAt"])!,
          }
        : null,
    allowance:
      typeof allowance["brand"] === "string" && num(allowance["leftPercent"]) !== null
        ? {
            brand: allowance["brand"],
            leftPercent: num(allowance["leftPercent"])!,
            resetsAt: num(allowance["resetsAt"]),
          }
        : null,
  };
}

export function parseSessionLimits(value: unknown): SessionLimits | null {
  const input = record(value);
  if (!("childId" in input)) return null;
  return {
    childId: typeof input["childId"] === "string" ? input["childId"] : null,
    needsChoice: input["needsChoice"] === true,
    limits: parseLimitState(input["limits"]),
    sentence: typeof input["sentence"] === "string" ? input["sentence"] : null,
  };
}

/** "7:00 am", "7:30 pm" in the household's zone. */
export function clockPhrase(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(at)
      .replace(/\s+/g, " ")
      .toLowerCase();
  } catch {
    return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
      .format(at)
      .toLowerCase();
  }
}

/** "19:30" → "7:30 pm". */
export function wallTimePhrase(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2]!;
  const period = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${twelve} ${period}` : `${twelve}:${minute} ${period}`;
}

/** "45 minutes", "1 hour", "1 hour 30 minutes". */
export function durationPhrase(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const minutePart = `${rest} ${rest === 1 ? "minute" : "minutes"}`;
  if (hours === 0) return minutePart;
  const hourPart = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? hourPart : `${hourPart} ${minutePart}`;
}

/** Tomorrow / today words for a wake-up time. */
function wakePhrase(wakesAt: number | null, now: number, timeZone: string): string | null {
  if (wakesAt === null) return null;
  const day = (at: number) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at);
    } catch {
      return new Date(at).toDateString();
    }
  };
  const when = clockPhrase(wakesAt, timeZone);
  return day(wakesAt) === day(now) ? `at ${when}` : `at ${when} tomorrow`;
}

export interface AsleepCopy {
  readonly title: string;
  readonly body: string;
}

/** What the asleep screen says, for a child, in a calm voice. */
export function asleepCopy(
  state: Pick<LimitState, "reason" | "wakesAt" | "allowance">,
  limits: ChildLimits | null,
  childName: string | null,
  now: number,
  timeZone: string,
): AsleepCopy {
  const wakes = wakePhrase(state.wakesAt, now, timeZone);
  const who = childName ? `, ${childName}` : "";
  switch (state.reason) {
    case "bedtime":
      return {
        title: "SKYCOT is asleep",
        body: `It's bedtime${who}. SKYCOT wakes up ${wakes ?? "in the morning"}. Your work is saved, just as you left it.`,
      };
    case "time":
      return {
        title: "SKYCOT is asleep",
        body: `That's ${limits?.dailyMinutes ? `today's ${durationPhrase(limits.dailyMinutes)}` : "all of today's time"}${who}. SKYCOT wakes up ${wakes ?? "tomorrow"}. Your work is saved.`,
      };
    case "turns":
      return {
        title: "SKYCOT is asleep",
        body: `That's ${limits?.dailyTurns ? `today's ${limits.dailyTurns} messages` : "all of today's messages"}${who}. SKYCOT wakes up ${wakes ?? "tomorrow"}. Your work is saved.`,
      };
    case "allowance":
      return {
        title: "SKYCOT is having a rest",
        body: `It's leaving some of the ${state.allowance?.brand ?? "AI"} allowance for the grown-ups${wakes ? `, and wakes up ${wakes}` : ""}. Your work is saved.`,
      };
    case null:
      return { title: "SKYCOT is awake", body: "" };
  }
}

/** The calm heads-up a few minutes before SKYCOT goes to sleep; null when none is due. */
export function headsUpSentence(
  state: Pick<LimitState, "headsUp" | "minutesLeft" | "passUntil" | "bedtime">,
): string | null {
  if (!state.headsUp || state.minutesLeft === null) return null;
  const left = state.minutesLeft <= 1 ? "About a minute left" : `${state.minutesLeft} minutes left`;
  const why =
    state.passUntil !== null
      ? "of a grown-up's extra time"
      : state.bedtime !== null && !state.bedtime.inside
        ? "before bedtime"
        : "of today's time";
  return `${left} ${why}. A good moment to finish what you're making.`;
}

/** One line per child for Settings: "Bedtime 7:30 pm – 7 am · 1 hour a day · 30 messages". */
export function limitsSummary(limits: ChildLimits): string {
  const parts: string[] = [];
  if (limits.bedtime) {
    parts.push(
      `Bedtime ${wallTimePhrase(limits.bedtime.start)} – ${wallTimePhrase(limits.bedtime.end)}`,
    );
  }
  if (limits.dailyMinutes !== null) parts.push(`${durationPhrase(limits.dailyMinutes)} a day`);
  if (limits.dailyTurns !== null) parts.push(`${limits.dailyTurns} messages a day`);
  if (limits.keepAllowancePercent !== null) {
    parts.push(`keeps ${limits.keepAllowancePercent}% of the AI allowance for grown-ups`);
  }
  return parts.length === 0 ? "No limits set" : parts.join(" · ");
}

/** "Today: 23 minutes · 7 messages", with the limit when there is one. */
export function todaySummary(
  state: Pick<LimitState, "usedMinutes" | "turns">,
  limits: ChildLimits,
): string {
  const minutes =
    limits.dailyMinutes === null
      ? durationPhrase(state.usedMinutes)
      : `${durationPhrase(state.usedMinutes)} of ${durationPhrase(limits.dailyMinutes)}`;
  const messages =
    limits.dailyTurns === null
      ? `${state.turns} ${state.turns === 1 ? "message" : "messages"}`
      : `${state.turns} of ${limits.dailyTurns} messages`;
  return `Today: ${minutes} · ${messages}`;
}

export const DAILY_MINUTE_OPTIONS = [null, 30, 45, 60, 90, 120] as const;
export const DAILY_TURN_OPTIONS = [null, 10, 20, 30, 50] as const;
export const KEEP_ALLOWANCE_OPTIONS = [null, 20, 30, 50] as const;
