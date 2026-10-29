import { describe, expect, it } from "vite-plus/test";

import { approvals, childErrors } from "./copy";

describe("child error copy", () => {
  it("gives a child a calm next step during a rest", () => {
    expect(childErrors.needsRest).toBe(
      "Sam needs a short rest. Your work is safe. You can look at your page while you wait.",
    );
    expect(childErrors.gotStuck).toBe(
      "Sam got stuck. Press Try again. If it keeps happening, ask a grown-up.",
    );
    expect(childErrors.allowance).toBe(
      "Sam needs a short rest. Your work is safe. You can look at your page while you wait.",
    );
    expect(approvals.ifNoQuestion).toBe("Sam carries on with its best guess.");
  });
});
