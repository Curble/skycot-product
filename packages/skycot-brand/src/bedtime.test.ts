import { describe, expect, it } from "vite-plus/test";

import {
  bedtimeAt,
  formatClockTime,
  knownTimeZone,
  localDay,
  nextLocalMidnight,
  parseClockTime,
} from "./bedtime.ts";

const MELBOURNE = "Australia/Melbourne";
const at = (iso: string) => new Date(iso);
const iso = (date: Date | undefined) => date?.toISOString();

describe("clock times", () => {
  it("reads and writes 24-hour times", () => {
    expect(parseClockTime("19:30")).toBe(1170);
    expect(parseClockTime("7:05")).toBe(425);
    expect(parseClockTime(" 00:00 ")).toBe(0);
    expect(parseClockTime("24:00")).toBeNull();
    expect(parseClockTime("7pm")).toBeNull();
    expect(formatClockTime(1170)).toBe("19:30");
    expect(formatClockTime(1440 + 5)).toBe("00:05");
  });

  it("falls back to UTC for a zone this runtime does not know", () => {
    expect(knownTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(knownTimeZone(null)).toBe("UTC");
    expect(knownTimeZone(MELBOURNE)).toBe(MELBOURNE);
  });
});

describe("today", () => {
  it("is the local calendar day, not UTC's", () => {
    // 23:30 UTC on the 21st is 10:30 on the 22nd in Melbourne (AEDT, +11).
    expect(localDay(at("2026-10-21T23:30:00Z"), MELBOURNE)).toBe("2026-10-22");
    expect(localDay(at("2026-10-21T23:30:00Z"), "UTC")).toBe("2026-10-21");
  });

  it("ends at the next local midnight", () => {
    expect(iso(nextLocalMidnight(at("2026-10-22T10:00:00+11:00"), MELBOURNE))).toBe(
      "2026-10-22T13:00:00.000Z",
    );
  });
});

describe("bedtime windows", () => {
  const night = { start: "19:30", end: "07:00" };

  it("covers the evening and the next morning as one window", () => {
    const evening = bedtimeAt(at("2026-10-22T20:00:00+11:00"), MELBOURNE, night)!;
    expect(evening.inside).toBe(true);
    expect(iso(evening.startsAt)).toBe("2026-10-22T08:30:00.000Z");
    expect(iso(evening.endsAt)).toBe("2026-10-22T20:00:00.000Z");

    const morning = bedtimeAt(at("2026-10-23T06:59:00+11:00"), MELBOURNE, night)!;
    expect(morning.inside).toBe(true);
    expect(iso(morning.endsAt)).toBe("2026-10-22T20:00:00.000Z");
  });

  it("names the next window during the day", () => {
    const day = bedtimeAt(at("2026-10-22T07:00:00+11:00"), MELBOURNE, night)!;
    expect(day.inside).toBe(false);
    expect(iso(day.startsAt)).toBe("2026-10-22T08:30:00.000Z");
  });

  it("handles a window inside one day", () => {
    const nap = { start: "13:00", end: "15:00" };
    expect(bedtimeAt(at("2026-10-22T14:00:00+11:00"), MELBOURNE, nap)!.inside).toBe(true);
    const after = bedtimeAt(at("2026-10-22T16:00:00+11:00"), MELBOURNE, nap)!;
    expect(after.inside).toBe(false);
    expect(iso(after.startsAt)).toBe("2026-10-23T02:00:00.000Z");
  });

  it("keeps the wall-clock hours across a daylight-saving change", () => {
    // Melbourne moves to AEDT on 4 Oct 2026: 07:00 that morning is +11, 19:30 the night before +10.
    const window = bedtimeAt(at("2026-10-03T21:00:00+10:00"), MELBOURNE, night)!;
    expect(iso(window.startsAt)).toBe("2026-10-03T09:30:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-10-03T20:00:00.000Z");
  });

  it("is no window when start equals end or a time does not parse", () => {
    expect(
      bedtimeAt(at("2026-10-22T20:00:00Z"), "UTC", { start: "07:00", end: "07:00" }),
    ).toBeNull();
    expect(
      bedtimeAt(at("2026-10-22T20:00:00Z"), "UTC", { start: "late", end: "07:00" }),
    ).toBeNull();
  });
});
