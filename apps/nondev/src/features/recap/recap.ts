// The grown-up recap, pure part of the client: the engine's report (`GET
// /api/skycot/family/recap`) in plain words. The engine already left out any words the
// shield would catch; this file only ever names their kind.
import { describePersonalCategories, type PersonalCategory } from "@t3tools/skycot-rules/personal";

import { describeChanges, fromCheckpointFiles } from "../../plain/changes";
import { grownUpSwitchLines } from "../../plain/switches";
import { clockPhrase } from "../family-limits/limits";

export type RecapRange = "session" | "week";

export interface RecapFile {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface RecapMade {
  readonly threadId: string;
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly title: string;
  readonly startedAt: number;
  readonly startedInRange: boolean;
  readonly lastAt: number;
  readonly changes: ReadonlyArray<{
    readonly checkpointId: string;
    readonly at: number;
    readonly files: ReadonlyArray<RecapFile>;
  }>;
  readonly page: string | null;
  readonly cwd: string | null;
}

export interface RecapAsk {
  readonly threadId: string;
  readonly at: number;
  readonly text: string | null;
  readonly hidden: ReadonlyArray<string>;
}

export interface MoreTimeEntry {
  readonly at: number;
  readonly kind: "extra" | "endBedtime";
  readonly minutes?: number;
  readonly reason: "bedtime" | "time" | "turns" | "allowance" | null;
}

export interface RecapReport {
  readonly childId: string;
  readonly range: RecapRange;
  readonly from: number;
  readonly to: number;
  readonly timeZone: string;
  readonly days: ReadonlyArray<{
    readonly date: string;
    readonly minutes: number;
    readonly turns: number;
  }>;
  readonly minutes: number;
  readonly messages: number;
  readonly made: ReadonlyArray<RecapMade>;
  readonly asks: ReadonlyArray<RecapAsk>;
  readonly grownUp: {
    readonly held: number;
    readonly approved: number;
    readonly moreTime: ReadonlyArray<MoreTimeEntry>;
    readonly shield: Readonly<Record<string, number>>;
    readonly shieldAllowed: number;
    /** Yeses from a grown-up's own device. Older engines leave it out. */
    readonly fromDevices?: ReadonlyArray<{ readonly at: number; readonly device: string }>;
    /** Turns moved to another company while the one in use rested. Older engines leave it out. */
    readonly switches?: ReadonlyArray<{
      readonly at: number;
      readonly from: string;
      readonly to: string;
    }>;
  };
  readonly proudOf: {
    readonly threadId: string;
    readonly title: string;
    readonly at: number;
    readonly page: string | null;
    readonly cwd: string | null;
  } | null;
}

/** A light check of the engine's answer: the shape the screens read, or null. */
export function parseRecap(body: unknown): RecapReport | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const grownUp = record["grownUp"];
  return typeof record["childId"] === "string" &&
    (record["range"] === "session" || record["range"] === "week") &&
    Array.isArray(record["days"]) &&
    Array.isArray(record["made"]) &&
    Array.isArray(record["asks"]) &&
    typeof grownUp === "object" &&
    grownUp !== null
    ? (body as RecapReport)
    : null;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "45 minutes", "1 hour 5 minutes", "2 hours". */
export function minutesPhrase(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

/** One "What changed" sentence for everything a conversation changed in the range. */
export function madeSummary(made: Pick<RecapMade, "changes">): string | null {
  if (made.changes.length === 0) return null;
  const byPath = new Map<string, RecapFile>();
  for (const change of made.changes) {
    for (const file of change.files) {
      const seen = byPath.get(file.path);
      byPath.set(
        file.path,
        seen === undefined
          ? file
          : {
              ...file,
              additions: seen.additions + file.additions,
              deletions: seen.deletions + file.deletions,
            },
      );
    }
  }
  const summary = describeChanges(fromCheckpointFiles([...byPath.values()])).summary;
  return made.changes.length === 1
    ? summary
    : `${summary} Over ${plural(made.changes.length, "change")}.`;
}

/** The child's words, or the kind of detail SKYCOT kept out of them. */
export function askLine(ask: Pick<RecapAsk, "text" | "hidden">): string {
  if (ask.text !== null) return `“${ask.text}”`;
  return `Something private (${describePersonalCategories(ask.hidden as ReadonlyArray<PersonalCategory>)}). SKYCOT kept the words out, so they aren't shown here.`;
}

const REASON: Readonly<Record<NonNullable<MoreTimeEntry["reason"]>, string>> = {
  bedtime: "at bedtime",
  time: "when the day's time ran out",
  turns: "when the day's messages ran out",
  allowance: "when SKYCOT was resting for the grown-ups' allowance",
};

/** What needed a grown-up, one sentence each; empty when nothing did. */
export function grownUpLines(report: Pick<RecapReport, "grownUp" | "timeZone">): Array<string> {
  const { held, approved, moreTime, shield, shieldAllowed } = report.grownUp;
  const lines: Array<string> = [];
  if (held > 0) {
    lines.push(
      `${plural(held, "step")} waited for a grown-up (the internet, an install, deleting, or outside the project)${
        approved > 0
          ? `; ${approved} ${approved === 1 ? "was" : "were"} allowed with the parent code`
          : ""
      }.`,
    );
  } else if (approved > 0) {
    lines.push(`A grown-up allowed ${plural(approved, "step")} with the parent code.`);
  }
  for (const entry of report.grownUp.fromDevices ?? []) {
    lines.push(`Approved from ${entry.device}, ${clockPhrase(entry.at, report.timeZone)}.`);
  }
  for (const entry of moreTime) {
    const when = clockPhrase(entry.at, report.timeZone);
    const why = entry.reason === null ? "" : ` ${REASON[entry.reason]}`;
    lines.push(
      entry.kind === "extra"
        ? `A grown-up gave ${entry.minutes ?? 15} more minutes at ${when}${why}.`
        : `A grown-up ended bedtime at ${when}.`,
    );
  }
  const caught = Object.entries(shield).filter(([, count]) => count > 0);
  if (caught.length > 0) {
    const parts = caught.map(
      ([category, count]) =>
        `${describePersonalCategories([category as PersonalCategory])}${count > 1 ? ` (${count} times)` : ""}`,
    );
    lines.push(
      `The shield spotted ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`} before it was sent.`,
    );
  }
  if (shieldAllowed > 0) {
    lines.push(`${plural(shieldAllowed, "message")} went as typed after a grown-up said yes.`);
  }
  lines.push(
    ...grownUpSwitchLines(report.grownUp.switches ?? [], (at) => clockPhrase(at, report.timeZone)),
  );
  return lines;
}

/** The headline: "Here's what Ava made today" / "Ava made 2 things this week". */
export function recapHeadline(report: Pick<RecapReport, "range" | "made">, name: string): string {
  const things = report.made.length;
  if (report.range === "session") {
    return things === 0 ? `${name} didn't make anything today` : `Here's what ${name} made today`;
  }
  return things === 0
    ? `A quiet week for ${name}`
    : `${name} made ${plural(things, "thing")} this week`;
}

/** The week as bars: each day's share of the busiest day, with a short weekday label. */
export function weekBars(days: RecapReport["days"]): Array<{
  readonly date: string;
  readonly label: string;
  readonly minutes: number;
  readonly share: number;
}> {
  const most = Math.max(1, ...days.map((day) => day.minutes));
  return days.map((day) => ({
    date: day.date,
    label: new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-AU", {
      weekday: "short",
      timeZone: "UTC",
    }),
    minutes: day.minutes,
    share: day.minutes / most,
  }));
}

/** The dates a report covers, for the printed page: "16–22 Oct 2026" or "Thursday 22 October". */
export function rangeLabel(report: Pick<RecapReport, "range" | "days">): string {
  const first = report.days[0]?.date;
  const last = report.days.at(-1)?.date;
  if (first === undefined || last === undefined) return "";
  const day = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString("en-AU", { ...options, timeZone: "UTC" });
  if (report.range === "session") {
    return day(last, { weekday: "long", day: "numeric", month: "long" });
  }
  return `${day(first, { day: "numeric", month: "short" })} – ${day(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * Whether this device already holds a grown-up's "yes" the engine accepts for the recap: the
 * recap's own, the Family settings' (which can already change the child) or Advanced mode's.
 * Asked before loading, so the code comes first and the engine is never asked in vain.
 */
export function recapOpenOn(
  openUntil: Partial<Readonly<Record<"recap" | "settings" | "advanced", number>>>,
  now: number,
): boolean {
  return [openUntil.recap, openUntil.settings, openUntil.advanced].some(
    (until) => until !== undefined && until > now,
  );
}
