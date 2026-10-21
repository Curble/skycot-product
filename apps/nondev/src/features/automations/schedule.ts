// Plain-English schedules for the engine's three trigger shapes, and the
// builders the New-automation sheet uses to produce them.
import type { ScheduledTaskSchedule, ScheduledTaskUpsertSchedule } from "@t3tools/contracts";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5];
const WEEKEND: ReadonlyArray<number> = [0, 6];

/** "09:00" → "9 am", "09:30" → "9:30 am", "12:00" → "12 pm", "00:00" → "midnight". */
export function formatTimeOfDay(timeOfDay: string): string {
  const [hoursRaw, minutesRaw] = timeOfDay.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeOfDay;
  if (hours === 0 && minutes === 0) return "midnight";
  if (hours === 12 && minutes === 0) return "noon";
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${twelve} ${suffix}`
    : `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function sameDays(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((day, index) => day === sb[index]);
}

/** "Weekdays", "Every day", "Mondays", "Weekends", "Mon, Wed and Fri". */
export function describeWeekdays(weekdays: ReadonlyArray<number> | undefined): string {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return "Every day";
  if (sameDays(weekdays, WEEKDAYS)) return "Weekdays";
  if (sameDays(weekdays, WEEKEND)) return "Weekends";
  const sorted = [...new Set(weekdays)].sort();
  if (sorted.length === 1) return `${DAY_NAMES[sorted[0]!]}s`;
  const names = sorted.map((day) => DAY_SHORT[day]!);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Every 30 minutes", "Every hour", "Every 2 hours", "Every day", "Every 3 days". */
export function describeInterval(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes < 60) return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "Every day" : `Every ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  const hours = Math.floor(minutes / 60);
  return `Every ${hours} h ${minutes % 60} min`;
}

export function describeSchedule(
  schedule: ScheduledTaskSchedule | ScheduledTaskUpsertSchedule,
): string {
  switch (schedule.type) {
    case "fixed_time":
      return `${describeWeekdays(schedule.weekdays)} at ${formatTimeOfDay(schedule.timeOfDay)}`;
    case "interval":
      return describeInterval(schedule.everyMs);
    case "webhook":
      return "When another app sends an event";
  }
}

/** "in 20 minutes", "in 3 hours", "tomorrow at 9 am", "2 days ago", "just now". */
export function describeRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const deltaMs = then.getTime() - now.getTime();
  const abs = Math.abs(deltaMs);
  const future = deltaMs > 0;
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  const time = formatTimeOfDay(
    `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`,
  );
  if (days === 1) return future ? `tomorrow at ${time}` : `yesterday at ${time}`;
  return future ? `in ${days} days` : `${days} days ago`;
}

export type SchedulePreset = "daily" | "weekdays" | "weekly" | "custom" | "interval";

export const INTERVAL_CHOICES: ReadonlyArray<{ readonly minutes: number; readonly label: string }> =
  [
    { minutes: 30, label: "Every 30 minutes" },
    { minutes: 60, label: "Every hour" },
    { minutes: 120, label: "Every 2 hours" },
    { minutes: 360, label: "Every 6 hours" },
    { minutes: 720, label: "Every 12 hours" },
  ];

export interface ScheduleDraft {
  readonly preset: SchedulePreset;
  /** "HH:MM", 24-hour. */
  readonly timeOfDay: string;
  /** For "weekly": the one day. For "custom": any set. */
  readonly weekdays: ReadonlyArray<number>;
  readonly intervalMinutes: number;
}

export const DEFAULT_SCHEDULE_DRAFT: ScheduleDraft = {
  preset: "weekdays",
  timeOfDay: "09:00",
  weekdays: [1],
  intervalMinutes: 60,
};

export function buildSchedule(draft: ScheduleDraft): ScheduledTaskUpsertSchedule | null {
  switch (draft.preset) {
    case "daily":
      return { type: "fixed_time", timeOfDay: draft.timeOfDay };
    case "weekdays":
      return { type: "fixed_time", timeOfDay: draft.timeOfDay, weekdays: [...WEEKDAYS] };
    case "weekly":
    case "custom": {
      const days = [...new Set(draft.weekdays)].sort();
      if (days.length === 0) return null;
      return { type: "fixed_time", timeOfDay: draft.timeOfDay, weekdays: days };
    }
    case "interval":
      return { type: "interval", everyMs: Math.max(1, draft.intervalMinutes) * 60_000 };
  }
}

export { DAY_SHORT, DAY_NAMES };
