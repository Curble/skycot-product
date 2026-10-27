import { describe, expect, it } from "vite-plus/test";

import { asleepLimitsFor } from "./asleepGate";
import type { SessionLimits } from "./limits";

const session = (childId: string, asleep: boolean) =>
  ({ childId, limits: { asleep } }) as unknown as SessionLimits;

describe("the asleep screen decision", () => {
  it("shows for the child on screen when the engine says asleep", () => {
    const asleep = session("leo", true);
    expect(asleepLimitsFor({ childId: "leo", session: asleep, grownUpActive: false })).toBe(
      asleep.limits,
    );
  });

  it("stays down while a grown-up's turn is open", () => {
    expect(
      asleepLimitsFor({ childId: "leo", session: session("leo", true), grownUpActive: true }),
    ).toBeNull();
  });

  it("comes back when the grown-up's turn closes and the child is still asleep", () => {
    const input = { childId: "leo", session: session("leo", true) };
    expect(asleepLimitsFor({ ...input, grownUpActive: true })).toBeNull();
    expect(asleepLimitsFor({ ...input, grownUpActive: false })).not.toBeNull();
  });

  it("ignores another child's asleep answer", () => {
    expect(
      asleepLimitsFor({ childId: "mia", session: session("leo", true), grownUpActive: false }),
    ).toBeNull();
  });

  it("stays down with no child, no answer, or an awake child", () => {
    expect(
      asleepLimitsFor({ childId: null, session: session("leo", true), grownUpActive: false }),
    ).toBeNull();
    expect(asleepLimitsFor({ childId: "leo", session: null, grownUpActive: false })).toBeNull();
    expect(
      asleepLimitsFor({ childId: "leo", session: session("leo", false), grownUpActive: false }),
    ).toBeNull();
  });
});
