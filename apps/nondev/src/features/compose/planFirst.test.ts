import { describe, expect, it } from "vite-plus/test";

import { planFirstFor, requestMode } from "./planFirst";

describe("plan first", () => {
  it("is off by default for a grown-up, and follows their switch", () => {
    expect(planFirstFor(false, false)).toEqual({ on: false, locked: false });
    expect(requestMode(planFirstFor(false, false))).toBe("default");
    expect(requestMode(planFirstFor(true, false))).toBe("plan");
  });

  it("is on and locked in a Family profile, whatever this browser says", () => {
    expect(planFirstFor(false, true)).toEqual({ on: true, locked: true });
    expect(requestMode(planFirstFor(false, true))).toBe("plan");
  });
});
