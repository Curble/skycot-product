import { describe, expect, it } from "vite-plus/test";

import { canReloadForEngineUpdate, engineBuildIsNewer } from "./engineUpdate";

describe("quiet engine updates", () => {
  it("recognizes only a newer compatible build", () => {
    expect(engineBuildIsNewer("0.1.2", "0.1.1")).toBe(true);
    expect(engineBuildIsNewer("0.1.0", "0.1.1")).toBe(false);
    expect(engineBuildIsNewer("dev", "0.1.1")).toBe(false);
  });

  it("waits until there is no running work or unsent text", () => {
    expect(canReloadForEngineUpdate({ hasActiveRun: false, hasUnsentText: false })).toBe(true);
    expect(canReloadForEngineUpdate({ hasActiveRun: true, hasUnsentText: false })).toBe(false);
    expect(canReloadForEngineUpdate({ hasActiveRun: false, hasUnsentText: true })).toBe(false);
  });
});
