import { describe, expect, it } from "vite-plus/test";

import {
  buildSchedule,
  describeInterval,
  describeRelative,
  describeSchedule,
  describeWeekdays,
  formatTimeOfDay,
} from "./schedule";

describe("formatTimeOfDay", () => {
  it("speaks 12-hour time", () => {
    expect(formatTimeOfDay("09:00")).toBe("9 am");
    expect(formatTimeOfDay("09:30")).toBe("9:30 am");
    expect(formatTimeOfDay("17:05")).toBe("5:05 pm");
    expect(formatTimeOfDay("12:00")).toBe("noon");
    expect(formatTimeOfDay("00:00")).toBe("midnight");
  });
});

describe("describeWeekdays", () => {
  it("names the common sets", () => {
    expect(describeWeekdays(undefined)).toBe("Every day");
    expect(describeWeekdays([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(describeWeekdays([5, 1, 3, 2, 4])).toBe("Weekdays");
    expect(describeWeekdays([0, 6])).toBe("Weekends");
    expect(describeWeekdays([1])).toBe("Mondays");
    expect(describeWeekdays([1, 3, 5])).toBe("Mon, Wed and Fri");
  });
});

describe("describeInterval", () => {
  it("picks the largest whole unit", () => {
    expect(describeInterval(30 * 60_000)).toBe("Every 30 minutes");
    expect(describeInterval(60 * 60_000)).toBe("Every hour");
    expect(describeInterval(2 * 60 * 60_000)).toBe("Every 2 hours");
    expect(describeInterval(24 * 60 * 60_000)).toBe("Every day");
    expect(describeInterval(90 * 60_000)).toBe("Every 1 h 30 min");
  });
});

describe("describeSchedule", () => {
  it("covers all three trigger shapes", () => {
    expect(
      describeSchedule({ type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] }),
    ).toBe("Weekdays at 9 am");
    expect(describeSchedule({ type: "interval", everyMs: 2 * 60 * 60_000 })).toBe("Every 2 hours");
    expect(describeSchedule({ type: "webhook", signature: null })).toBe(
      "When another app sends an event",
    );
  });
});

describe("buildSchedule", () => {
  it("turns presets into engine schedules", () => {
    expect(
      buildSchedule({ preset: "daily", timeOfDay: "08:15", weekdays: [], intervalMinutes: 60 }),
    ).toEqual({ type: "fixed_time", timeOfDay: "08:15" });
    expect(
      buildSchedule({ preset: "weekdays", timeOfDay: "09:00", weekdays: [], intervalMinutes: 60 }),
    ).toEqual({ type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] });
    expect(
      buildSchedule({ preset: "interval", timeOfDay: "09:00", weekdays: [], intervalMinutes: 120 }),
    ).toEqual({ type: "interval", everyMs: 7_200_000 });
    expect(
      buildSchedule({ preset: "custom", timeOfDay: "09:00", weekdays: [], intervalMinutes: 60 }),
    ).toBeNull();
  });
});

describe("describeRelative", () => {
  it("rounds to the nearest friendly unit", () => {
    const now = new Date("2026-10-21T09:00:00");
    expect(describeRelative("2026-10-21T09:20:00", now)).toBe("in 20 min");
    expect(describeRelative("2026-10-21T06:00:00", now)).toBe("3 h ago");
    expect(describeRelative("2026-10-22T09:00:00", now)).toBe("tomorrow at 9 am");
    expect(describeRelative("2026-10-25T09:00:00", now)).toBe("in 4 days");
  });
});
