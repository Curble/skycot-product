import { describe, expect, it } from "vite-plus/test";

import { grownUpAnswerLabel, parseGrownUpAnswers } from "./grownUpAnswers";

describe("grown-up answers", () => {
  it("says who answered, or a grown-up when the shared code did", () => {
    expect(grownUpAnswerLabel({ decision: "accept", by: "Mum" })).toBe("Mum said yes");
    expect(grownUpAnswerLabel({ decision: "decline", by: "Dad" })).toBe("Dad said not this time");
    expect(grownUpAnswerLabel({ decision: "accept", by: null })).toBe("A grown-up said yes");
  });

  it("reads only well-formed answers", () => {
    expect(parseGrownUpAnswers({ nope: true })).toBeNull();
    expect(
      parseGrownUpAnswers({
        answers: [
          { requestId: "r1", decision: "accept", by: "Mum", at: 1 },
          { requestId: "r2", decision: "maybe", by: "Mum", at: 2 },
          { requestId: "r3", decision: "decline", by: "  ", at: 3 },
          null,
        ],
      }),
    ).toEqual([
      { requestId: "r1", decision: "accept", by: "Mum", at: 1 },
      { requestId: "r3", decision: "decline", by: null, at: 3 },
    ]);
  });
});
