// The grown-up recap from fixtures: two children, a week of days, and messages the shield
// would catch, which must reach the parent as a kind of detail only.
import { describe, expect, it } from "@effect/vitest";
import { EXPLAIN_ON_MARKER } from "@t3tools/skycot-rules/explain";
import { withPointing } from "@t3tools/skycot-rules/preview";

import type { ActivitySnapshot } from "../family-limits/SkycotFamilyLimits.ts";
import { askFor, buildRecap, rangeStart, startOfLocalDay, type RecapThreadInput } from "./recap.ts";

const MELBOURNE = "Australia/Melbourne";
const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-10-22T18:00:00+11:00");

const page = (path: string) => ({ path, kind: "modified", additions: 10, deletions: 0 });

const thread = (overrides: Partial<RecapThreadInput> & { threadId: string }): RecapThreadInput => ({
  projectId: "project:games",
  projectTitle: "Games",
  title: "Space game",
  createdAt: at("2026-10-22T15:00:00+11:00"),
  cwd: "/Users/kid/games",
  messages: [],
  checkpoints: [],
  runs: [],
  heldAt: [],
  ...overrides,
});

const activity: ActivitySnapshot = {
  threads: {
    "thread:space": "ava",
    "thread:maze": "ava",
    "thread:old": "ava",
    "thread:leo": "leo",
  },
  projects: { "project:games": "ava" },
  days: {
    ava: {
      date: "2026-10-22",
      minutes: 42,
      lastMinute: null,
      turns: 6,
      passUntil: null,
      bedtimeSkippedUntil: null,
    },
  },
  history: {
    ava: [
      { date: "2026-10-14", minutes: 99, turns: 9 },
      { date: "2026-10-20", minutes: 30, turns: 4 },
    ],
  },
  log: [
    {
      at: at("2026-10-22T17:00:00+11:00"),
      childId: "ava",
      kind: "extra",
      minutes: 15,
      reason: "time",
    },
    { at: at("2026-10-22T17:00:00+11:00"), childId: "leo", kind: "endBedtime", reason: "bedtime" },
  ],
  events: [
    {
      at: at("2026-10-22T16:00:00+11:00"),
      childId: "ava",
      kind: "shield",
      categories: ["full-name", "school"],
    },
    {
      at: at("2026-10-21T16:00:00+11:00"),
      childId: "ava",
      kind: "shield",
      categories: ["full-name"],
    },
    {
      at: at("2026-10-22T16:01:00+11:00"),
      childId: "ava",
      kind: "shield-allowed",
      categories: ["full-name"],
    },
    {
      at: at("2026-10-22T16:30:00+11:00"),
      childId: "ava",
      kind: "approved",
      threadId: "thread:space",
    },
    { at: at("2026-10-22T16:30:00+11:00"), childId: "leo", kind: "approved" },
  ],
  // Claude was resting, so the model fallback carried a turn on ChatGPT (and one of Leo's).
  switches: [
    {
      at: at("2026-10-22T16:40:00+11:00"),
      childId: "ava",
      threadId: "thread:space",
      from: "claudeAgent",
      to: "codex",
      until: null,
    },
    {
      at: at("2026-10-22T16:40:00+11:00"),
      childId: "leo",
      threadId: "thread:leo",
      from: "claudeAgent",
      to: "codex",
      until: null,
    },
  ],
};

const threads: ReadonlyArray<RecapThreadInput> = [
  thread({
    threadId: "thread:space",
    messages: [
      {
        id: "m1",
        createdBy: "user",
        text: `Make a space game with stars${EXPLAIN_ON_MARKER}`,
        createdAt: at("2026-10-22T15:00:00+11:00"),
      },
      {
        id: "m2",
        createdBy: "user",
        text: "my name is Ava Smith and I go to St Kilda Primary",
        createdAt: at("2026-10-22T15:10:00+11:00"),
      },
      { id: "m3", createdBy: "agent", text: "wake up", createdAt: at("2026-10-22T15:20:00+11:00") },
    ],
    checkpoints: [
      {
        id: "c1",
        runId: "r1",
        capturedAt: at("2026-10-22T15:05:00+11:00"),
        files: [page("index.html")],
      },
      {
        id: "c2",
        runId: "r2",
        capturedAt: at("2026-10-22T15:15:00+11:00"),
        files: [page("style.css")],
      },
      {
        id: "c3",
        runId: "r3",
        capturedAt: at("2026-10-22T15:25:00+11:00"),
        files: [page("index.html")],
      },
    ],
    runs: [
      { id: "r1", status: "completed" },
      { id: "r2", status: "completed" },
      { id: "r3", status: "rolled_back" },
    ],
    heldAt: [at("2026-10-22T15:30:00+11:00"), at("2026-10-10T15:30:00+11:00")],
  }),
  thread({
    threadId: "thread:maze",
    title: "Maze",
    createdAt: at("2026-10-20T10:00:00+11:00"),
    messages: [
      {
        id: "m4",
        createdBy: "user",
        text: "Add a maze",
        createdAt: at("2026-10-20T10:00:00+11:00"),
      },
    ],
    checkpoints: [
      {
        id: "c4",
        runId: "r4",
        capturedAt: at("2026-10-20T10:05:00+11:00"),
        files: [page("maze/index.html")],
      },
    ],
    runs: [{ id: "r4", status: "completed" }],
  }),
  thread({
    threadId: "thread:old",
    title: "Old",
    createdAt: at("2026-10-01T10:00:00+11:00"),
    messages: [
      { id: "m5", createdBy: "user", text: "Old", createdAt: at("2026-10-01T10:00:00+11:00") },
    ],
  }),
  thread({
    threadId: "thread:leo",
    title: "Leo's robot",
    messages: [
      {
        id: "m6",
        createdBy: "user",
        text: "Robot dance",
        createdAt: at("2026-10-22T15:00:00+11:00"),
      },
    ],
  }),
];

describe("the household's days", () => {
  it("starts today and the week at local midnight", () => {
    expect(startOfLocalDay(NOW, MELBOURNE)).toBe(Date.parse("2026-10-21T13:00:00.000Z"));
    expect(rangeStart("week", NOW, MELBOURNE)).toBe(Date.parse("2026-10-15T13:00:00.000Z"));
  });
});

describe("askFor", () => {
  it("never keeps words the shield would catch, only their kinds", () => {
    expect(askFor("my name is Ava Smith and I go to St Kilda Primary")).toEqual({
      text: null,
      hidden: ["full-name", "school"],
    });
  });

  it("keeps an ordinary request short, without the explain marker", () => {
    expect(askFor(`Make it blue${EXPLAIN_ON_MARKER}`)).toEqual({
      text: "Make it blue",
      hidden: [],
    });
    expect(askFor("x".repeat(140)).text).toHaveLength(100);
  });

  it("shows what was pointed at in the preview as words, not markup", () => {
    const pointer = {
      label: "the big pink title",
      pageUrl: "http://localhost:5173/",
      tagName: "h1",
      selector: "h1",
      html: "<h1>Welcome</h1>",
    };
    expect(askFor(withPointing("make this bigger", [pointer]))).toEqual({
      text: "make this bigger",
      hidden: [],
    });
    expect(askFor(`${withPointing("", [pointer])}${EXPLAIN_ON_MARKER}`)).toEqual({
      text: "Pointed at the big pink title",
      hidden: [],
    });
  });
});

describe("buildRecap", () => {
  it("sums a child's week from today's counters and the kept days", () => {
    const week = buildRecap({
      childId: "ava",
      range: "week",
      now: NOW,
      timeZone: MELBOURNE,
      activity,
      threads,
    });
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ]);
    // The 14th is older than the week.
    expect(week.minutes).toBe(72);
    expect(week.messages).toBe(10);
    expect(week.made.map((made) => made.threadId)).toEqual(["thread:space", "thread:maze"]);
    expect(week.grownUp.shield).toEqual({ "full-name": 2, school: 1 });
  });

  it("reports what Ava made today, and what was hidden only by its kind", () => {
    const today = buildRecap({
      childId: "ava",
      range: "session",
      now: NOW,
      timeZone: MELBOURNE,
      activity,
      threads,
    });
    expect(today.minutes).toBe(42);
    expect(today.made.map((made) => made.threadId)).toEqual(["thread:space"]);
    const space = today.made[0]!;
    // The undone change is left out; the page comes from the newest kept change that had one.
    expect(space.changes.map((change) => change.checkpointId)).toEqual(["c1", "c2"]);
    expect(space.page).toBe("index.html");
    expect(today.asks).toEqual([
      {
        threadId: "thread:space",
        at: at("2026-10-22T15:10:00+11:00"),
        text: null,
        hidden: ["full-name", "school"],
      },
      {
        threadId: "thread:space",
        at: at("2026-10-22T15:00:00+11:00"),
        text: "Make a space game with stars",
        hidden: [],
      },
    ]);
    expect(JSON.stringify(today)).not.toContain("Smith");
    expect(JSON.stringify(today)).not.toContain("Kilda");
    expect(today.grownUp).toEqual({
      held: 1,
      approved: 1,
      moreTime: [activity.log[0]],
      shield: { "full-name": 1, school: 1 },
      shieldAllowed: 1,
      // That yes was typed on the Mac; one from a grown-up's phone would name the phone here.
      fromDevices: [],
      switches: [{ at: at("2026-10-22T16:40:00+11:00"), from: "claudeAgent", to: "codex" }],
    });
    expect(today.proudOf).toEqual({
      threadId: "thread:space",
      title: "Space game",
      at: at("2026-10-22T15:05:00+11:00"),
      page: "index.html",
      cwd: "/Users/kid/games",
    });
  });

  it("says a yes was given with Face ID on the grown-up's own phone", () => {
    const yes = {
      at: at("2026-10-22T15:20:00+11:00"),
      childId: "ava",
      kind: "approved" as const,
      threadId: "thread:space",
      requestId: "req-9",
      by: {
        personId: "mark",
        deviceId: "d1",
        deviceName: "Mark's iPhone",
        how: "face-id" as const,
        biometry: "face-id" as const,
      },
    };
    const today = buildRecap({
      childId: "ava",
      range: "session",
      now: NOW,
      timeZone: MELBOURNE,
      activity: { ...activity, events: [...(activity.events ?? []), yes] },
      threads,
    });
    expect(today.grownUp.fromDevices).toEqual([
      { at: yes.at, device: "Mark's iPhone", with: "Face ID" },
    ]);
  });

  it("names the Watch and the phone that carried a yes from the wrist", () => {
    const yes = {
      at: at("2026-10-22T15:20:00+11:00"),
      childId: "ava",
      kind: "approved" as const,
      threadId: "thread:space",
      requestId: "req-9",
      by: {
        personId: "mum",
        deviceId: "d1",
        deviceName: "Mum's iPhone",
        via: { kind: "watch" as const, name: "Mum's Apple Watch" },
      },
    };
    const today = buildRecap({
      childId: "ava",
      range: "session",
      now: NOW,
      timeZone: MELBOURNE,
      activity: { ...activity, events: [...(activity.events ?? []), yes] },
      threads,
    });
    expect(today.grownUp.fromDevices).toEqual([
      { at: yes.at, device: "Mum's Apple Watch through Mum's iPhone" },
    ]);
  });

  it("keeps each child's recap to their own work", () => {
    const leo = buildRecap({
      childId: "leo",
      range: "session",
      now: NOW,
      timeZone: MELBOURNE,
      activity,
      threads,
    });
    expect(leo.made.map((made) => made.title)).toEqual(["Leo's robot"]);
    expect(leo.proudOf).toBeNull();
    expect(leo.grownUp.approved).toBe(1);
    expect(leo.grownUp.moreTime.map((entry) => entry.kind)).toEqual(["endBedtime"]);
    expect(leo.minutes).toBe(0);
  });
});
