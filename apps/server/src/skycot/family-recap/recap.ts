// The grown-up recap, pure part: one child's session (today) or week, from the conversations
// the engine knows the child started and the Family activity file. What they made (each
// conversation with its "What changed" file lists, which the client puts into plain words),
// what they asked for, what needed a grown-up, the time used and a "Most proud of" pick.
//
// The one hard rule: words the shield would catch never leave here. A message with a full
// name, a school, an address (or anything else the detector finds) is reported by the kind of
// detail only, whether the child nicknamed it, a grown-up let it go as typed, or another
// client sent it. The detector is the same one the composer card and the engine use.
// The household's day boundaries come from the shared bedtime helpers, which speak `Date`.
// @effect-diagnostics globalDate:off
import { localDay, nextLocalMidnight } from "@t3tools/skycot-brand/bedtime";
import { readExplainMarker } from "@t3tools/skycot-rules/explain";
import { readPointing } from "@t3tools/skycot-rules/preview";
import { findPersonalDetails, personalCategories } from "@t3tools/skycot-rules/personal";

import type { ActivitySnapshot, MoreTimeLogEntry } from "../family-limits/SkycotFamilyLimits.ts";

export type RecapRange = "session" | "week";
export const RECAP_RANGES: ReadonlyArray<RecapRange> = ["session", "week"];

const HOUR = 60 * 60_000;
const ASK_CHARS = 100;
const ASKS_KEEP = 24;

export interface RecapFile {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface RecapThreadInput {
  readonly threadId: string;
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly title: string;
  readonly createdAt: number;
  /** Where its files are: the private copy, else the project's folder. */
  readonly cwd: string | null;
  /**
   * A "Just ask" question (no project). Its messages count like any other; it is something
   * they made only once it changed a file.
   */
  readonly question?: boolean;
  /** The thread's user-role messages; `createdBy` tells the child's own from wake-ups. */
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly createdBy: string;
    readonly text: string;
    readonly createdAt: number;
  }>;
  /** Root checkpoints (one per turn, plus manual saves), any order. */
  readonly checkpoints: ReadonlyArray<{
    readonly id: string;
    readonly runId: string | null;
    readonly capturedAt: number;
    readonly files: ReadonlyArray<RecapFile>;
  }>;
  readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
  /** Steps in this thread the Family rules held for a grown-up, by when they were asked. */
  readonly heldAt: ReadonlyArray<number>;
}

export interface RecapChange {
  readonly checkpointId: string;
  readonly at: number;
  readonly files: ReadonlyArray<RecapFile>;
}

export interface RecapMade {
  readonly threadId: string;
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly title: string;
  readonly startedAt: number;
  /** True when the conversation was started inside the range (not only continued). */
  readonly startedInRange: boolean;
  readonly lastAt: number;
  readonly changes: ReadonlyArray<RecapChange>;
  /** The page "Open it" would show, from the newest change that touched one. */
  readonly page: string | null;
  readonly cwd: string | null;
}

export interface RecapAsk {
  readonly threadId: string;
  readonly at: number;
  /** The child's words, shortened; null when the shield would catch something in them. */
  readonly text: string | null;
  /** The kinds of detail that kept the words out ("full-name", "school"…). */
  readonly hidden: ReadonlyArray<string>;
}

export interface RecapDay {
  readonly date: string;
  readonly minutes: number;
  readonly turns: number;
}

export interface RecapReport {
  readonly childId: string;
  readonly range: RecapRange;
  readonly from: number;
  readonly to: number;
  readonly timeZone: string;
  readonly days: ReadonlyArray<RecapDay>;
  readonly minutes: number;
  readonly messages: number;
  readonly made: ReadonlyArray<RecapMade>;
  readonly asks: ReadonlyArray<RecapAsk>;
  readonly grownUp: {
    readonly held: number;
    readonly approved: number;
    readonly moreTime: ReadonlyArray<MoreTimeLogEntry>;
    /** Shield catches by kind of detail. */
    readonly shield: Readonly<Record<string, number>>;
    /** Messages a grown-up let go as typed. */
    readonly shieldAllowed: number;
    /** Yeses given from a grown-up's own device: when, and which device (by its name then). */
    readonly fromDevices: ReadonlyArray<{ readonly at: number; readonly device: string }>;
  };
  readonly proudOf: {
    readonly threadId: string;
    readonly title: string;
    readonly at: number;
    readonly page: string | null;
    readonly cwd: string | null;
  } | null;
}

/** The instant the household's day containing `at` began. */
export function startOfLocalDay(at: number, timeZone: string): number {
  let start = nextLocalMidnight(new Date(at - 30 * HOUR), timeZone).getTime();
  for (;;) {
    const next = nextLocalMidnight(new Date(start), timeZone).getTime();
    if (next > at) return start;
    start = next;
  }
}

/** Where a range starts: today's midnight, or the midnight six days before it. */
export function rangeStart(range: RecapRange, now: number, timeZone: string): number {
  let start = startOfLocalDay(now, timeZone);
  if (range === "week") {
    for (let day = 0; day < 6; day += 1) start = startOfLocalDay(start - 1, timeZone);
  }
  return start;
}

const isPage = (path: string) => /\.html?$/i.test(path);
const isDeleted = (kind: string) => /^(d|del|delete|deleted|remove|removed)$/i.test(kind.trim());

/** The page to show from one change: `index.html` first, then any other page. */
export function pageOf(files: ReadonlyArray<RecapFile>): string | null {
  const pages = files.filter((file) => isPage(file.path) && !isDeleted(file.kind));
  const index = pages.find((file) => /(^|\/)index\.html?$/i.test(file.path));
  return (index ?? pages[0])?.path ?? null;
}

/** The child's words for the recap, or only the kinds of detail when the shield would catch any. */
export function askFor(text: string): { readonly text: string | null; readonly hidden: string[] } {
  // What they pointed at in the preview reads as "Pointed at the big pink title", not markup.
  const pointing = readPointing(readExplainMarker(text).text);
  const words = (
    pointing.text.trim().length > 0 || pointing.labels.length === 0
      ? pointing.text
      : `Pointed at ${pointing.labels.join(", ")}`
  ).trim();
  const hidden = personalCategories(findPersonalDetails(words));
  if (hidden.length > 0) return { text: null, hidden };
  const line =
    words
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "";
  if (line.length === 0) return { text: null, hidden: [] };
  return {
    text: line.length > ASK_CHARS ? `${line.slice(0, ASK_CHARS - 1).trimEnd()}…` : line,
    hidden: [],
  };
}

function daysIn(
  activity: ActivitySnapshot,
  childId: string,
  from: number,
  to: number,
  timeZone: string,
): Array<RecapDay> {
  const known = new Map<string, RecapDay>();
  for (const past of activity.history[childId] ?? []) known.set(past.date, past);
  const current = activity.days[childId];
  if (current !== undefined) {
    known.set(current.date, { date: current.date, minutes: current.minutes, turns: current.turns });
  }
  const days: Array<RecapDay> = [];
  for (
    let start = from;
    start < to;
    start = nextLocalMidnight(new Date(start), timeZone).getTime()
  ) {
    const date = localDay(new Date(start), timeZone);
    days.push(known.get(date) ?? { date, minutes: 0, turns: 0 });
  }
  return days;
}

export function buildRecap(input: {
  readonly childId: string;
  readonly range: RecapRange;
  readonly now: number;
  readonly timeZone: string;
  readonly activity: ActivitySnapshot;
  readonly threads: ReadonlyArray<RecapThreadInput>;
}): RecapReport {
  const { childId, activity, timeZone, now } = input;
  const from = rangeStart(input.range, now, timeZone);
  const to = now;
  const inRange = (at: number) => at >= from && at <= to;
  const mine = input.threads.filter((thread) => activity.threads[thread.threadId] === childId);

  const made: Array<RecapMade> = [];
  const asks: Array<RecapAsk> = [];
  let held = 0;
  let proudOf: RecapReport["proudOf"] = null;
  for (const thread of mine) {
    const undone = new Set(
      thread.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
    );
    const finished = new Set(
      thread.runs.filter((run) => run.status === "completed").map((run) => run.id),
    );
    const changes = thread.checkpoints
      .filter(
        (checkpoint) =>
          inRange(checkpoint.capturedAt) &&
          checkpoint.files.length > 0 &&
          (checkpoint.runId === null || !undone.has(checkpoint.runId)),
      )
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .map((checkpoint) => ({
        checkpointId: checkpoint.id,
        at: checkpoint.capturedAt,
        files: checkpoint.files,
        finished: checkpoint.runId === null || finished.has(checkpoint.runId),
      }));
    const own = thread.messages.filter(
      (message) => message.createdBy === "user" && inRange(message.createdAt),
    );
    held += thread.heldAt.filter(inRange).length;
    if (changes.length === 0 && own.length === 0 && !inRange(thread.createdAt)) continue;
    for (const message of own) {
      const ask = askFor(message.text);
      if (ask.text !== null || ask.hidden.length > 0) {
        asks.push({ threadId: thread.threadId, at: message.createdAt, ...ask });
      }
    }
    if (thread.question === true && changes.length === 0) continue;
    const withPage = changes.findLast((change) => pageOf(change.files) !== null);
    const page = withPage ? pageOf(withPage.files) : null;
    const lastAt = Math.max(
      thread.createdAt,
      ...changes.map((change) => change.at),
      ...own.map((message) => message.createdAt),
    );
    made.push({
      threadId: thread.threadId,
      projectId: thread.projectId,
      projectTitle: thread.projectTitle,
      title: thread.title,
      startedAt: thread.createdAt,
      startedInRange: inRange(thread.createdAt),
      lastAt,
      changes: changes.map(({ finished: _finished, ...change }) => change),
      page,
      cwd: thread.cwd,
    });
    // "Most proud of": the newest finished change, a page over anything else.
    const done = changes.filter((change) => change.finished);
    const pick = done.findLast((change) => pageOf(change.files) !== null) ?? done.at(-1);
    if (pick !== undefined) {
      const pickPage = pageOf(pick.files);
      const better =
        proudOf === null ||
        (pickPage !== null && proudOf.page === null) ||
        ((pickPage !== null) === (proudOf.page !== null) && pick.at > proudOf.at);
      if (better) {
        proudOf = {
          threadId: thread.threadId,
          title: thread.title,
          at: pick.at,
          page: pickPage,
          cwd: thread.cwd,
        };
      }
    }
  }

  const events = activity.events.filter((event) => event.childId === childId && inRange(event.at));
  const shield: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "shield") continue;
    for (const category of event.categories ?? []) shield[category] = (shield[category] ?? 0) + 1;
  }
  const days = daysIn(activity, childId, from, to, timeZone);
  return {
    childId,
    range: input.range,
    from,
    to,
    timeZone,
    days,
    minutes: days.reduce((sum, day) => sum + day.minutes, 0),
    messages: days.reduce((sum, day) => sum + day.turns, 0),
    made: made.sort((a, b) => b.lastAt - a.lastAt),
    asks: asks.sort((a, b) => b.at - a.at).slice(0, ASKS_KEEP),
    grownUp: {
      held,
      approved: events.filter((event) => event.kind === "approved").length,
      moreTime: activity.log.filter((entry) => entry.childId === childId && inRange(entry.at)),
      shield,
      shieldAllowed: events.filter((event) => event.kind === "shield-allowed").length,
      fromDevices: events.flatMap((event) =>
        event.kind === "approved" && event.by !== undefined
          ? [{ at: event.at, device: event.by.deviceName }]
          : [],
      ),
    },
    proudOf,
  };
}
