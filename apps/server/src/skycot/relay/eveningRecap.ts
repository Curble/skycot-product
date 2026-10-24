// One evening nudge to the grown-ups' phones when a child made something today: "See what your
// family made today" (the words live on the relay; the push carries only its kind). The phone
// shows the day from the recap it already reads. Sent once a day, in a short window after 7 pm
// on this Mac's clock, so an engine restart later that evening never sends it again.

export const RECAP_HOUR = 19;
const WINDOW_MINUTES = 30;

/** The Mac's own time zone. */
export const macTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

function parts(at: number, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${values["year"]}-${values["month"]}-${values["day"]}`,
    minutes: Number(values["hour"]) * 60 + Number(values["minute"]),
  };
}

/** "2026-10-25" in the given time zone. */
export function localDay(at: number, timeZone: string): string {
  return parts(at, timeZone).day;
}

/**
 * The day to send the evening recap for, or null: inside the window, not sent yet today, and a
 * child's conversation finished something since this morning.
 */
export function eveningRecapDue(input: {
  readonly now: number;
  readonly timeZone: string;
  readonly lastSentDay: string | null;
  readonly childFinishedAt: ReadonlyArray<number>;
}): string | null {
  const { day: today, minutes } = parts(input.now, input.timeZone);
  if (minutes < RECAP_HOUR * 60 || minutes >= RECAP_HOUR * 60 + WINDOW_MINUTES) return null;
  if (input.lastSentDay === today) return null;
  return input.childFinishedAt.some((at) => localDay(at, input.timeZone) === today) ? today : null;
}
