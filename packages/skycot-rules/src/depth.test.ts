// nondev-seam: skycot-rules-package
import { describe, expect, it } from "vite-plus/test";

import { isEffortOptionId, withoutEffortOptions } from "./depth.ts";

describe("thinking depth options", () => {
  it("knows the effort ids whatever their case", () => {
    for (const id of ["reasoningEffort", "effort", "Effort", " reasoning_effort ", "THINKING"]) {
      expect(isEffortOptionId(id), id).toBe(true);
    }
    for (const id of ["fastMode", "serviceTier", "model"]) expect(isEffortOptionId(id)).toBe(false);
  });

  it("drops only the effort options", () => {
    expect(
      withoutEffortOptions([
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ id: "fastMode", value: true }]);
    expect(withoutEffortOptions([{ id: "effort", value: "max" }])).toBeUndefined();
  });

  it("returns the same array when there is nothing to drop", () => {
    const options = [{ id: "fastMode", value: true }];
    expect(withoutEffortOptions(options)).toBe(options);
    expect(withoutEffortOptions(undefined)).toBeUndefined();
  });
});
