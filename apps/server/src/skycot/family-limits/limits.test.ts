import { describe, expect, it } from "vite-plus/test";

import { NO_LIMITS, type ChildLimits } from "../SkycotFamily.ts";
import {
  allowanceReading,
  applyMoreTime,
  countMinute,
  countTurn,
  dayAt,
  evaluateLimits,
  freshDay,
  lastChildSession,
  SESSION_GAP_MS,
  trackChildSession,
  closeChildSession,
  type ChildDay,
} from "./limits.ts";

const ZONE = "Australia/Melbourne";
const at = (iso: string) => Date.parse(iso);
const MINUTE = 60_000;

const evaluate = (limits: Partial<ChildLimits>, day: ChildDay | undefined, iso: string) =>
  evaluateLimits({
    limits: { ...NO_LIMITS, ...limits },
    day,
    now: at(iso),
    timeZone: ZONE,
    allowance: null,
  });

describe("counting time", () => {
  it("counts each minute once, however many heartbeats land in it", () => {
    const start = at("2026-10-22T16:00:10+11:00");
    let day: ChildDay | undefined;
    for (const offset of [0, 15_000, 30_000, 45_000]) day = countMinute(day, start + offset, ZONE);
    expect(day!.minutes).toBe(1);
    day = countMinute(day, start + MINUTE, ZONE);
    expect(day.minutes).toBe(2);
  });

  it("never fills in a gap, and counts nothing for a clock moved back", () => {
    const start = at("2026-10-22T16:00:00+11:00");
    let day = countMinute(undefined, start, ZONE);
    day = countMinute(day, start + 30 * MINUTE, ZONE);
    expect(day.minutes).toBe(2);
    day = countMinute(day, start + 10 * MINUTE, ZONE);
    expect(day.minutes).toBe(2);
  });

  it("starts again at local midnight, keeping a grown-up's extra time that is still running", () => {
    const late = at("2026-10-22T23:50:00+11:00");
    let day = countTurn(undefined, late, ZONE);
    day = { ...day, passUntil: late + 30 * MINUTE };
    const next = dayAt(day, at("2026-10-23T00:05:00+11:00"), ZONE);
    expect(next.date).toBe("2026-10-23");
    expect(next.minutes).toBe(0);
    expect(next.turns).toBe(0);
    expect(next.passUntil).toBe(late + 30 * MINUTE);
  });

  it("counts a turn as a message and as the minute it started in", () => {
    const day = countTurn(undefined, at("2026-10-22T10:00:00+11:00"), ZONE);
    expect([day.turns, day.minutes]).toEqual([1, 1]);
  });
});

describe("evaluateLimits", () => {
  it("is awake with nothing coming when there are no limits", () => {
    const state = evaluate({}, undefined, "2026-10-22T21:00:00+11:00");
    expect(state).toMatchObject({ asleep: false, reason: null, minutesLeft: null, headsUp: false });
  });

  it("gives a heads-up five minutes before bedtime and sleeps until the morning", () => {
    const bedtime = { bedtime: { start: "19:30", end: "07:00" } };
    expect(evaluate(bedtime, undefined, "2026-10-22T19:20:00+11:00")).toMatchObject({
      asleep: false,
      minutesLeft: 10,
      headsUp: false,
    });
    expect(evaluate(bedtime, undefined, "2026-10-22T19:25:00+11:00")).toMatchObject({
      minutesLeft: 5,
      headsUp: true,
      changesAt: at("2026-10-22T19:30:00+11:00"),
    });
    expect(evaluate(bedtime, undefined, "2026-10-22T19:30:00+11:00")).toMatchObject({
      asleep: true,
      reason: "bedtime",
      wakesAt: at("2026-10-23T07:00:00+11:00"),
    });
  });

  it("stops when the day's minutes are used, and wakes after the next bedtime", () => {
    const limits = { dailyMinutes: 60, bedtime: { start: "20:00", end: "07:00" } };
    const used = { ...freshDay("2026-10-22"), minutes: 56 };
    expect(evaluate(limits, used, "2026-10-22T15:00:00+11:00")).toMatchObject({
      minutesLeft: 4,
      headsUp: true,
    });
    expect(evaluate(limits, { ...used, minutes: 60 }, "2026-10-22T15:00:00+11:00")).toMatchObject({
      asleep: true,
      reason: "time",
      wakesAt: at("2026-10-23T07:00:00+11:00"),
    });
  });

  it("stops at the day's messages, waking at midnight when no bedtime covers it", () => {
    const state = evaluate(
      { dailyTurns: 20 },
      { ...freshDay("2026-10-22"), turns: 20 },
      "2026-10-22T15:00:00+11:00",
    );
    expect(state).toMatchObject({
      asleep: true,
      reason: "turns",
      wakesAt: at("2026-10-23T00:00:00+11:00"),
    });
  });

  it("pauses at the allowance line and wakes when the window refills", () => {
    const state = evaluateLimits({
      limits: { ...NO_LIMITS, keepAllowancePercent: 30 },
      day: undefined,
      now: at("2026-10-22T15:00:00+11:00"),
      timeZone: ZONE,
      allowance: { brand: "ChatGPT", leftPercent: 28, resetsAt: at("2026-10-22T17:40:00+11:00") },
    });
    expect(state).toMatchObject({
      asleep: true,
      reason: "allowance",
      wakesAt: at("2026-10-22T17:40:00+11:00"),
    });
  });

  it("a grown-up's extra time keeps it awake, counts down, and adds up", () => {
    const limits = { ...NO_LIMITS, bedtime: { start: "19:30", end: "07:00" } };
    const now = at("2026-10-22T20:00:00+11:00");
    let day = applyMoreTime(undefined, limits, { type: "extra", minutes: 15 }, now, ZONE);
    day = applyMoreTime(day, limits, { type: "extra", minutes: 15 }, now + 5 * MINUTE, ZONE);
    expect(day.passUntil).toBe(now + 30 * MINUTE);
    expect(
      evaluateLimits({ limits, day, now: now + 26 * MINUTE, timeZone: ZONE, allowance: null }),
    ).toMatchObject({
      asleep: false,
      minutesLeft: 4,
      headsUp: true,
      changesAt: now + 30 * MINUTE,
    });
    expect(
      evaluateLimits({ limits, day, now: now + 30 * MINUTE, timeZone: ZONE, allowance: null })
        .asleep,
    ).toBe(true);
  });

  it("ending bedtime early skips tonight's window only", () => {
    const limits = { ...NO_LIMITS, bedtime: { start: "19:30", end: "07:00" } };
    const now = at("2026-10-22T20:00:00+11:00");
    const day = applyMoreTime(undefined, limits, { type: "endBedtime" }, now, ZONE);
    expect(evaluateLimits({ limits, day, now, timeZone: ZONE, allowance: null }).asleep).toBe(
      false,
    );
    const tomorrowNight = at("2026-10-23T20:00:00+11:00");
    expect(
      evaluateLimits({ limits, day, now: tomorrowNight, timeZone: ZONE, allowance: null }).asleep,
    ).toBe(true);
  });
});

describe("allowanceReading", () => {
  const provider = (
    windows: ReadonlyArray<{ id: string; usedPercent: number; resetsAt?: string }>,
  ) =>
    ({
      driver: "codex",
      auth: { status: "authenticated" },
      usageLimits: {
        checkedAt: "2026-10-22T04:00:00.000Z",
        windows: windows.map((window) => ({ kind: "session", label: window.id, ...window })),
      },
    }) as never;

  it("reads the window that runs out first", () => {
    const reading = allowanceReading(
      provider([
        { id: "primary", usedPercent: 40, resetsAt: "2026-10-22T06:00:00.000Z" },
        { id: "secondary", usedPercent: 75, resetsAt: "2026-10-27T00:00:00.000Z" },
      ]),
      at("2026-10-22T04:00:00Z"),
    );
    expect(reading).toEqual({
      brand: "ChatGPT",
      leftPercent: 25,
      resetsAt: at("2026-10-27T00:00:00Z"),
    });
  });

  it("ignores a window that has already reset, and says nothing for an account with none", () => {
    expect(
      allowanceReading(
        provider([{ id: "primary", usedPercent: 99, resetsAt: "2026-10-22T03:00:00.000Z" }]),
        at("2026-10-22T04:00:00Z"),
      ),
    ).toBeNull();
    expect(
      allowanceReading({ driver: "codex", auth: { status: "authenticated" } } as never, 0),
    ).toBeNull();
  });
});

describe("a child's work session", () => {
  const M = 60_000;
  it("grows while the same child stays active and writes only once a minute", () => {
    const one = trackChildSession([], "ava", 1000 * M);
    expect(one).toEqual([
      { id: "ava-60000000", childId: "ava", startedAt: 1000 * M, endedAt: 1000 * M },
    ]);
    expect(trackChildSession(one, "ava", 1000 * M + 20_000)).toBe(one);
    expect(trackChildSession(one, "ava", 1010 * M)[0]).toMatchObject({ endedAt: 1010 * M });
  });

  it("starts a new session after a switch to another child", () => {
    let list = trackChildSession([], "ava", 1000 * M);
    list = trackChildSession(list, "leo", 1005 * M);
    list = trackChildSession(list, "ava", 1010 * M);
    expect(list.map((session) => session.childId)).toEqual(["ava", "leo", "ava"]);
    expect(lastChildSession(list, "leo")?.startedAt).toBe(1005 * M);
  });

  it("starts a new session after a gap of more than an hour, not at exactly an hour", () => {
    const first = trackChildSession([], "ava", 1000 * M);
    expect(trackChildSession(first, "ava", 1000 * M + SESSION_GAP_MS)).toHaveLength(1);
    expect(trackChildSession(first, "ava", 1000 * M + SESSION_GAP_MS + 1)).toHaveLength(2);
    expect(lastChildSession([], "ava")).toBeNull();
  });

  it("starts a new session after a grown-up closed the last one, even within the gap", () => {
    const open = trackChildSession([], "ava", 1000 * M);
    const closed = closeChildSession(open, 1001 * M);
    expect(closed[0]).toMatchObject({ closed: true, endedAt: 1000 * M });
    const next = trackChildSession(closed, "ava", 1002 * M);
    expect(next).toHaveLength(2);
    expect(next[1]!.id).not.toBe(next[0]!.id);
    expect(lastChildSession(next, "ava")).toMatchObject({ startedAt: 1002 * M });
    // The new session grows normally and is not closed.
    expect(trackChildSession(next, "ava", 1010 * M)).toHaveLength(2);
  });

  it("closing with nothing open changes nothing", () => {
    const empty: ReadonlyArray<never> = [];
    expect(closeChildSession(empty, 1000 * M)).toBe(empty);
    const closed = closeChildSession(trackChildSession([], "ava", 1000 * M), 1000 * M);
    expect(closeChildSession(closed, 1001 * M)).toBe(closed);
    expect(closeChildSession(closed, 1001 * M, "leo")).toBe(closed);
  });
});
