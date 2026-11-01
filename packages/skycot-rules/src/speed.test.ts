// nondev-seam: skycot-rules-package
import { describe, expect, it } from "vite-plus/test";

import { isSpeedOptionId, withoutHeldOptions, withoutSpeedOptions } from "./speed.ts";

describe("speed options", () => {
  it("knows the speed ids whatever their spelling", () => {
    for (const id of [
      "fastMode",
      "serviceTier",
      "service_tier",
      "FAST_MODE",
      " speed ",
      "fast-mode",
    ])
      expect(isSpeedOptionId(id), id).toBe(true);
    for (const id of ["effort", "reasoningEffort", "model", "thinking"])
      expect(isSpeedOptionId(id), id).toBe(false);
  });

  it("drops only the speed options", () => {
    expect(
      withoutSpeedOptions([
        { id: "serviceTier", value: "fast" },
        { id: "reasoningEffort", value: "high" },
      ]),
    ).toEqual([{ id: "reasoningEffort", value: "high" }]);
    expect(withoutSpeedOptions([{ id: "fastMode", value: true }])).toBeUndefined();
  });

  it("returns the same array when there is nothing to drop", () => {
    const options = [{ id: "effort", value: "max" }];
    expect(withoutSpeedOptions(options)).toBe(options);
    expect(withoutSpeedOptions(undefined)).toBeUndefined();
  });

  it("drops depth and speed together, keeping the rest", () => {
    expect(
      withoutHeldOptions([
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
        { id: "contextWindow", value: "1m" },
      ]),
    ).toEqual([{ id: "contextWindow", value: "1m" }]);
    const plain = [{ id: "contextWindow", value: "1m" }];
    expect(withoutHeldOptions(plain)).toBe(plain);
  });
});
