import { describe, expect, it } from "vite-plus/test";

import { childActivity, grownUpActivity } from "./state";

const at = new Date("2026-10-23T09:00:00Z");

describe("the Lock Screen's words", () => {
  it("says Sam is building on a child's device, and nothing about the project", () => {
    const activity = childActivity({ building: 1, waiting: 0, builder: "Sam" }, at);
    expect(activity?.headline).toBe("Sam is building…");
    expect(JSON.stringify(activity)).not.toMatch(/space game/iu);
  });

  it("shows the number of requests that need a grown-up", () => {
    expect(grownUpActivity({ waitingChildNames: ["Ava"] }, at)?.headline).toBe(
      "1 request needs a grown-up",
    );
    expect(
      grownUpActivity({ waitingChildNames: ["Ava", "Ava", "Leo"], waitingCount: 3 }, at)?.headline,
    ).toBe("3 requests need a grown-up");
  });

  it("goes quiet when nothing is happening", () => {
    expect(childActivity({ building: 0, waiting: 0, builder: "Sam" }, at)).toBeNull();
    expect(grownUpActivity({ waitingChildNames: [] }, at)).toBeNull();
  });
});
