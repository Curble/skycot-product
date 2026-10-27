// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import {
  askLine,
  grownUpLines,
  madeSummary,
  minutesPhrase,
  nothingBuiltSentence,
  parseRecap,
  recapHeadline,
  lastSessionSeen,
  markLastSessionSeen,
  recapOpenOn,
  shouldOfferLastSession,
  weekBars,
} from "./recap";

const MELBOURNE = "Australia/Melbourne";
const file = (path: string, additions = 10) => ({
  path,
  kind: "modified",
  additions,
  deletions: 0,
});

describe("the recap in plain words", () => {
  it("says time like a person", () => {
    expect(minutesPhrase(1)).toBe("1 minute");
    expect(minutesPhrase(45)).toBe("45 minutes");
    expect(minutesPhrase(60)).toBe("1 hour");
    expect(minutesPhrase(125)).toBe("2 hours 5 minutes");
  });

  it("puts a conversation's changes into one What-changed sentence", () => {
    expect(
      madeSummary({
        changes: [
          { checkpointId: "c1", at: 1, files: [file("index.html")] },
          { checkpointId: "c2", at: 2, files: [file("index.html", 5), file("style.css")] },
        ],
      }),
    ).toBe("Changed 2 files: 1 page and 1 style file (+25 / −0 lines). Over 2 changes.");
    expect(madeSummary({ changes: [] })).toBeNull();
  });

  it("names only the kind of detail the shield kept out", () => {
    expect(askLine({ text: "Make it blue", hidden: [] })).toBe("“Make it blue”");
    const hidden = askLine({ text: null, hidden: ["full-name", "school"] });
    expect(hidden).toContain("a full name and a school's name");
    expect(hidden).toContain("kept the words out");
  });

  it("lists what needed a grown-up", () => {
    expect(
      grownUpLines({
        timeZone: MELBOURNE,
        grownUp: {
          held: 2,
          approved: 1,
          moreTime: [
            {
              at: Date.parse("2026-10-22T17:00:00+11:00"),
              kind: "extra",
              minutes: 15,
              reason: "time",
            },
          ],
          shield: { "full-name": 2, school: 1 },
          shieldAllowed: 1,
        },
      }),
    ).toEqual([
      "2 steps waited for a grown-up (the internet, an install, deleting, or outside the project); 1 was allowed with the parent code.",
      "A grown-up gave 15 more minutes at 5:00 pm when the day's time ran out.",
      "The private-details check spotted a full name (2 times) and a school's name before it was sent.",
      "1 message went as typed after a grown-up said yes.",
    ]);
    expect(
      grownUpLines({
        timeZone: MELBOURNE,
        grownUp: { held: 0, approved: 0, moreTime: [], shield: {}, shieldAllowed: 0 },
      }),
    ).toEqual([]);
    // What SKYCOT added by itself, for the grown-ups.
    expect(
      grownUpLines(
        {
          timeZone: MELBOURNE,
          grownUp: {
            held: 0,
            approved: 0,
            moreTime: [],
            shield: {},
            shieldAllowed: 0,
            addOns: [{ at: Date.parse("2026-10-22T04:10:00Z"), names: ["three"], how: "trusted" }],
          },
        },
        "Ava",
      ),
    ).toEqual(["SKYCOT added three.js for Ava, 3:10 pm (a trusted add-on)."]);
    // A yes from a grown-up's own phone names the phone.
    expect(
      grownUpLines({
        timeZone: MELBOURNE,
        grownUp: {
          held: 1,
          approved: 1,
          moreTime: [],
          shield: {},
          shieldAllowed: 0,
          fromDevices: [{ at: Date.parse("2026-10-22T18:42:00+11:00"), device: "Mum's phone" }],
        },
      }),
    ).toContain("Approved from Mum's phone, 6:42 pm.");
  });

  it("says a yes was given with Face ID on the grown-up's phone", () => {
    const lines = grownUpLines({
      timeZone: MELBOURNE,
      grownUp: {
        held: 1,
        approved: 1,
        moreTime: [],
        shield: {},
        shieldAllowed: 0,
        fromDevices: [
          {
            at: Date.parse("2026-10-22T18:42:00+11:00"),
            device: "Mark's iPhone",
            with: "Face ID",
          },
        ],
      },
    });
    expect(lines).toContain("Approved with Face ID on Mark's iPhone, 6:42 pm.");
    // Not "with the parent code" when a yes wasn't.
    expect(lines.join(" ")).not.toContain("parent code");
  });

  it("draws the week against its busiest day", () => {
    const bars = weekBars([
      { date: "2026-10-21", minutes: 20, turns: 2 },
      { date: "2026-10-22", minutes: 40, turns: 3 },
    ]);
    expect(bars.map((bar) => [bar.label, bar.share])).toEqual([
      ["Wed", 0.5],
      ["Thu", 1],
    ]);
  });

  it("refuses an answer that is not a recap", () => {
    expect(parseRecap({ error: "forbidden" })).toBeNull();
  });
});

describe("asking for the code before the recap loads", () => {
  it("loads straight away only while a yes the engine accepts is open on this device", () => {
    const now = 1_000_000;
    expect(recapOpenOn({}, now)).toBe(false);
    expect(recapOpenOn({ publish: now + 60_000 } as never, now)).toBe(false);
    expect(recapOpenOn({ recap: now - 1 }, now)).toBe(false);
    expect(recapOpenOn({ recap: now + 60_000 }, now)).toBe(true);
    expect(recapOpenOn({ settings: now + 60_000 }, now)).toBe(true);
    expect(recapOpenOn({ advanced: now + 60_000 }, now)).toBe(true);
  });
});

describe("a day with a plan but nothing built yet", () => {
  const quiet = { range: "session" as const, made: [], messages: 0, asks: [] };
  const planning = { ...quiet, messages: 1 };

  it("counts asking Sam as activity instead of saying nothing happened", () => {
    expect(recapHeadline(quiet, "Lily")).toBe("Lily didn't make anything today");
    expect(recapHeadline(planning, "Lily")).toBe("Lily has been planning something today");
    expect(nothingBuiltSentence(quiet, "Lily", "today")).toBe("No conversations today.");
    expect(nothingBuiltSentence(planning, "Lily", "today")).toContain("asking Sam");
  });
});

describe("the last session offer", () => {
  const report = (id: string, endedAgo: number) => ({
    range: "last-session" as const,
    session: { id, startedAt: Date.now() - endedAgo - 600_000, endedAt: Date.now() - endedAgo },
  });
  it("is offered once the session has been quiet a while, and never again after Got it", () => {
    window.localStorage.clear();
    expect(shouldOfferLastSession(report("s1", 10 * 60_000), Date.now())).toBe(true);
    // Seconds after the child stopped is the normal case: the parent just took the Mac over.
    expect(shouldOfferLastSession(report("s2", 30_000), Date.now())).toBe(true);
    markLastSessionSeen("s1");
    expect(lastSessionSeen("s1")).toBe(true);
    expect(shouldOfferLastSession(report("s1", 10 * 60_000), Date.now())).toBe(false);
    expect(shouldOfferLastSession(report("s3", 10 * 60_000), Date.now())).toBe(true);
  });
  it("is not offered for a report without a session, and parses and words the new range", () => {
    expect(shouldOfferLastSession({ range: "last-session" }, Date.now())).toBe(false);
    expect(shouldOfferLastSession({ range: "session" }, Date.now())).toBe(false);
    expect(recapHeadline({ range: "last-session", made: [], messages: 0 }, "Ava")).toBe(
      "Ava didn't make anything last time",
    );
    expect(
      parseRecap({
        childId: "ava",
        range: "last-session",
        days: [],
        made: [],
        asks: [],
        grownUp: {},
      }),
    ).not.toBeNull();
  });
});
