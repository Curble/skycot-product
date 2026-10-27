import { describe, expect, it } from "vite-plus/test";

import { isNotTheirsMessage, NOT_THEIRS_MESSAGE } from "./ownership";

describe("family ownership refusals", () => {
  it("recognizes the engine's exact child ownership refusal", () => {
    expect(isNotTheirsMessage(NOT_THEIRS_MESSAGE)).toBe(true);
    expect(isNotTheirsMessage("Check your Mac is awake and try again.")).toBe(false);
    expect(isNotTheirsMessage(undefined)).toBe(false);
  });
});
