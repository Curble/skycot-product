import { describe, expect, it } from "vite-plus/test";

import type { FamilyDeviceSummary, FamilyMe } from "../family/people";
import { grownUpPhonesLinked, moreTimeWays } from "./moreTimeWays";

const shared: FamilyMe = { kind: "shared" };
const childDevice: FamilyMe = { kind: "child", deviceId: "d1", deviceName: "iPad", childId: "c1" };
const device = (kind: "child" | "grown-up", personId: string): FamilyDeviceSummary => ({
  id: `${kind}-${personId}`,
  kind,
  personId,
  name: "Phone",
  passkeys: 0,
  watch: null,
  faceId: false,
});
const mum = { id: "mum", name: "Mum", avatar: {} as never };

describe("ways to get more time", () => {
  it("offers both on the shared Mac when a grown-up phone is linked", () => {
    expect(moreTimeWays({ me: shared, grownUpPhonesLinked: true, childView: true })).toEqual([
      "code",
      "phone",
    ]);
  });
  it("offers only the code on the shared Mac with no linked phone", () => {
    expect(moreTimeWays({ me: shared, grownUpPhonesLinked: false, childView: true })).toEqual([
      "code",
    ]);
  });
  it("keeps the phone request only on a child's own device", () => {
    expect(moreTimeWays({ me: childDevice, grownUpPhonesLinked: true, childView: true })).toEqual([
      "phone",
    ]);
    expect(moreTimeWays({ me: childDevice, grownUpPhonesLinked: false, childView: true })).toEqual([
      "phone",
    ]);
  });
  it("keeps the code box when it is not a child view", () => {
    expect(moreTimeWays({ me: shared, grownUpPhonesLinked: true, childView: false })).toEqual([
      "code",
    ]);
    expect(moreTimeWays({ me: childDevice, grownUpPhonesLinked: true, childView: false })).toEqual([
      "code",
    ]);
  });
});

describe("linked grown-up phones", () => {
  it("is true when a grown-up device belongs to a listed grown-up", () => {
    expect(grownUpPhonesLinked([mum], [device("grown-up", "mum")])).toBe(true);
  });
  it("ignores child devices, unknown people and an empty list", () => {
    expect(grownUpPhonesLinked([mum], [device("child", "mum")])).toBe(false);
    expect(grownUpPhonesLinked([mum], [device("grown-up", "ghost")])).toBe(false);
    expect(grownUpPhonesLinked([mum], [])).toBe(false);
  });
});
