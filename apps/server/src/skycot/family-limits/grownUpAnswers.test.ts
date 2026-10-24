import { assert, describe, it } from "@effect/vitest";

import { grownUpAnswersFor } from "./grownUpAnswers.ts";
import type { FamilyEvent } from "./SkycotFamilyLimits.ts";

const grownUps = [
  { id: "mum", name: "Sarah Example" },
  { id: "dad", name: null },
];

const event = (input: Partial<FamilyEvent> & Pick<FamilyEvent, "kind" | "at">): FamilyEvent => ({
  childId: "ava",
  threadId: "thread-1",
  ...input,
});

describe("grownUpAnswersFor", () => {
  it("gives the child only a first name and a time, per request", () => {
    const answers = grownUpAnswersFor(
      [
        event({
          kind: "approved",
          at: 1_000,
          requestId: "r1",
          by: { personId: "mum", deviceId: "phone-1", deviceName: "Sarah's iPhone" },
        }),
        event({
          kind: "declined",
          at: 2_000,
          requestId: "r2",
          by: { personId: "dad", deviceId: "phone-2", deviceName: "Dad's iPhone" },
        }),
        // The parent code on the Mac: shared, so no name.
        event({ kind: "approved", at: 3_000, requestId: "r3" }),
      ],
      "thread-1",
      grownUps,
    );
    assert.deepStrictEqual(answers, [
      { requestId: "r1", decision: "accept", by: "Sarah", at: 1_000 },
      { requestId: "r2", decision: "decline", by: null, at: 2_000 },
      { requestId: "r3", decision: "accept", by: null, at: 3_000 },
    ]);
    // No device names or ids ever reach the child.
    assert.notInclude(JSON.stringify(answers), "iPhone");
    assert.notInclude(JSON.stringify(answers), "phone-1");
  });

  it("ignores other conversations, events without a request, and other kinds", () => {
    assert.deepStrictEqual(
      grownUpAnswersFor(
        [
          event({ kind: "approved", at: 1, requestId: "r1", threadId: "other" }),
          event({ kind: "approved", at: 2 }),
          event({ kind: "shield", at: 3, requestId: "r4" }),
        ],
        "thread-1",
        grownUps,
      ),
      [],
    );
  });
});
