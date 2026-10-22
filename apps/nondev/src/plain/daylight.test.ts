import { describe, expect, it } from "vite-plus/test";

import { mascotPhase, parseMascotOverride, phaseAt } from "./daylight";

describe("mascot phase", () => {
  it("follows the sky unless Settings pins a drawing", () => {
    const evening = phaseAt(new Date("2026-10-22T21:00:00+11:00"), "Australia/Melbourne").phase;
    expect(evening).toBe("dusk");
    expect(mascotPhase(evening, parseMascotOverride(null))).toBe("dusk");
    expect(mascotPhase(evening, parseMascotOverride("day"))).toBe("day");
    expect(mascotPhase("day", parseMascotOverride("dusk"))).toBe("dusk");
  });

  it("treats anything unexpected in storage as follow the sky", () => {
    expect(parseMascotOverride("night")).toBeNull();
    expect(parseMascotOverride("")).toBeNull();
  });
});
