import { describe, expect, it } from "vite-plus/test";

import { childErrors } from "./copy";

describe("child error copy", () => {
  it("uses short words for a rest and a stuck turn", () => {
    expect(childErrors.needsRest).toBe("Sam needs a rest. Try again later.");
    expect(childErrors.gotStuck).toBe("Sam got stuck. Press Try again.");
    expect(childErrors.allowance).toBe(
      "SKYCOT is resting for now. Your work is saved. Grown-ups need some time on it too.",
    );
  });
});
