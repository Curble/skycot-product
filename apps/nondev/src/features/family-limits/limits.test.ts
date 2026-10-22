import { describe, expect, it } from "vite-plus/test";

import { NO_LIMITS } from "../family/children";
import {
  asleepCopy,
  durationPhrase,
  headsUpSentence,
  limitsSummary,
  parseSessionLimits,
  todaySummary,
  wallTimePhrase,
} from "./limits";
import { childFirst } from "./order";
import { parseToday } from "./store";

const ZONE = "Australia/Melbourne";
const at = (iso: string) => Date.parse(iso);

describe("what the engine says", () => {
  it("reads the session, and nothing from a body without one", () => {
    expect(parseSessionLimits({})).toBeNull();
    const session = parseSessionLimits({
      childId: "a",
      needsChoice: false,
      sentence: "It's bedtime.",
      limits: {
        asleep: true,
        reason: "bedtime",
        minutesLeft: null,
        headsUp: false,
        wakesAt: 1,
        changesAt: 1,
        usedMinutes: 12,
        turns: 4,
        passUntil: null,
        bedtime: { inside: true, startsAt: 0, endsAt: 1 },
        allowance: null,
      },
    });
    expect(session?.limits).toMatchObject({ asleep: true, reason: "bedtime", turns: 4 });
  });

  it("reads every child's day and who started what", () => {
    const today = parseToday({
      children: [
        {
          childId: "a",
          limits: { asleep: false, usedMinutes: 3, turns: 1 },
          moreTime: [{ at: 5, kind: "extra", minutes: 15 }, { kind: "nonsense" }],
        },
      ],
      threads: { t1: "a", t2: 4 },
      projects: {},
    });
    expect(today?.children[0]?.moreTime).toEqual([{ at: 5, kind: "extra", minutes: 15 }]);
    expect(today?.threads).toEqual({ t1: "a" });
  });
});

describe("the asleep screen's words", () => {
  const now = at("2026-10-22T20:00:00+11:00");

  it("says when SKYCOT wakes, and that the work is saved", () => {
    const copy = asleepCopy(
      { reason: "bedtime", wakesAt: at("2026-10-23T07:00:00+11:00"), allowance: null },
      NO_LIMITS,
      "Ava",
      now,
      ZONE,
    );
    expect(copy.title).toBe("SKYCOT is asleep");
    expect(copy.body).toBe(
      "It's bedtime, Ava. SKYCOT wakes up at 7:00 am tomorrow. Your work is saved, just as you left it.",
    );
  });

  it("names the day's time or messages", () => {
    const limits = { ...NO_LIMITS, dailyMinutes: 90, dailyTurns: 30 };
    const wakes = at("2026-10-23T00:00:00+11:00");
    expect(
      asleepCopy({ reason: "time", wakesAt: wakes, allowance: null }, limits, null, now, ZONE).body,
    ).toContain("today's 1 hour 30 minutes");
    expect(
      asleepCopy({ reason: "turns", wakesAt: wakes, allowance: null }, limits, null, now, ZONE)
        .body,
    ).toContain("today's 30 messages");
  });

  it("says the allowance rest is for the grown-ups", () => {
    const copy = asleepCopy(
      {
        reason: "allowance",
        wakesAt: null,
        allowance: { brand: "ChatGPT", leftPercent: 20, resetsAt: null },
      },
      NO_LIMITS,
      null,
      now,
      ZONE,
    );
    expect(copy.title).toBe("SKYCOT is having a rest");
    expect(copy.body).toContain("ChatGPT allowance for the grown-ups");
  });
});

describe("heads-up and summaries", () => {
  it("only speaks up when it is due", () => {
    const base = {
      headsUp: true,
      minutesLeft: 5,
      passUntil: null,
      bedtime: { inside: false, startsAt: 0, endsAt: 0 },
    };
    expect(headsUpSentence(base)).toBe(
      "5 minutes left before bedtime. A good moment to finish what you're making.",
    );
    expect(headsUpSentence({ ...base, headsUp: false })).toBeNull();
    expect(headsUpSentence({ ...base, minutesLeft: 1, bedtime: null })).toBe(
      "About a minute left of today's time. A good moment to finish what you're making.",
    );
    expect(headsUpSentence({ ...base, passUntil: 1 })).toContain("of a grown-up's extra time");
  });

  it("sums up a child's limits and day in one line each", () => {
    const limits = {
      bedtime: { start: "19:30", end: "07:00" },
      dailyMinutes: 60,
      dailyTurns: 30,
      keepAllowancePercent: 30,
    };
    expect(limitsSummary(limits)).toBe(
      "Bedtime 7:30 pm – 7 am · 1 hour a day · 30 messages a day · keeps 30% of the AI allowance for grown-ups",
    );
    expect(limitsSummary(NO_LIMITS)).toBe("No limits set");
    expect(todaySummary({ usedMinutes: 23, turns: 7 }, limits)).toBe(
      "Today: 23 minutes of 1 hour · 7 of 30 messages",
    );
    expect(todaySummary({ usedMinutes: 1, turns: 1 }, NO_LIMITS)).toBe(
      "Today: 1 minute · 1 message",
    );
    expect(wallTimePhrase("00:05")).toBe("12:05 am");
    expect(durationPhrase(125)).toBe("2 hours 5 minutes");
  });
});

describe("the child's conversations first", () => {
  it("splits the list by who started each conversation", () => {
    const rows = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    const owners = { t1: "leo", t2: "ava" };
    expect(childFirst(rows, (row) => row.id, owners, "ava")).toEqual({
      mine: [{ id: "t2" }],
      others: [{ id: "t1" }, { id: "t3" }],
    });
    expect(childFirst(rows, (row) => row.id, owners, null)).toBeNull();
  });
});
