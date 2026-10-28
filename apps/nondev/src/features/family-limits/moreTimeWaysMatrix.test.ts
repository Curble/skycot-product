import { describe, expect, it } from "vite-plus/test";

import type { FamilyMe } from "../family/people";
import { moreTimeWays, type MoreTimeWay } from "./moreTimeWays";

const shared: FamilyMe = { kind: "shared" };
const childDevice: FamilyMe = { kind: "child", deviceId: "d1", deviceName: "iPad", childId: "c1" };

// One row per situation the asleep screen can be in: who is holding the device, whether it is
// showing a child's view, and whether a grown-up's phone is linked.
const rows: ReadonlyArray<
  readonly [string, FamilyMe, boolean, boolean, ReadonlyArray<MoreTimeWay>]
> = [
  ["shared Mac, child view, phone linked", shared, true, true, ["code", "phone"]],
  ["shared Mac, child view, no phone", shared, false, true, ["code"]],
  ["shared Mac, grown-up view, phone linked", shared, true, false, ["code"]],
  ["shared Mac, grown-up view, no phone", shared, false, false, ["code"]],
  ["child's device, phone linked", childDevice, true, true, ["phone"]],
  ["child's device, no phone", childDevice, false, true, ["phone"]],
  ["child's device, not a child view, phone linked", childDevice, true, false, ["code"]],
  ["child's device, not a child view, no phone", childDevice, false, false, ["code"]],
];

describe("ways to get more time, every combination", () => {
  it.each(rows)("%s", (_name, me, linked, childView, expected) => {
    expect(moreTimeWays({ me, grownUpPhonesLinked: linked, childView })).toEqual(expected);
  });

  it("never offers a way twice or none at all", () => {
    for (const [, me, linked, childView] of rows) {
      const ways = moreTimeWays({ me, grownUpPhonesLinked: linked, childView });
      expect(ways.length).toBeGreaterThan(0);
      expect(new Set(ways).size).toBe(ways.length);
    }
  });
});
