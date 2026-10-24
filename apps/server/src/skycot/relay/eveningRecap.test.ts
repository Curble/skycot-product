import { assert, describe, it } from "@effect/vitest";

import { eveningRecapDue } from "./eveningRecap.ts";

const ZONE = "UTC";
const at = (hours: number, minutes = 0, day = 25) => Date.UTC(2026, 9, day, hours, minutes);
const due = (now: number, lastSentDay: string | null, childFinishedAt: ReadonlyArray<number>) =>
  eveningRecapDue({ now, timeZone: ZONE, lastSentDay, childFinishedAt });

describe("eveningRecapDue", () => {
  it("sends once, just after 7 pm, when a child made something today", () => {
    const made = [at(16, 20)];
    assert.equal(due(at(19, 5), null, made), "2026-10-25");
    // Already sent today, or outside the window (a restart at 9 pm): nothing more.
    assert.isNull(due(at(19, 10), "2026-10-25", made));
    assert.isNull(due(at(21), null, made));
    assert.isNull(due(at(18, 59), null, made));
  });

  it("stays quiet on a day nothing was made", () => {
    assert.isNull(due(at(19, 5), null, [at(16, 0, 24)]));
    assert.isNull(due(at(19, 5), null, []));
  });

  it("uses the family's own clock", () => {
    // 19:05 in Melbourne is 08:05 UTC the same day.
    const melbourne = Date.UTC(2026, 9, 25, 8, 5);
    assert.equal(
      eveningRecapDue({
        now: melbourne,
        timeZone: "Australia/Melbourne",
        lastSentDay: null,
        childFinishedAt: [Date.UTC(2026, 9, 25, 3, 0)],
      }),
      "2026-10-25",
    );
  });
});
