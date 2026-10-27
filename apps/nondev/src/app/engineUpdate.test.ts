import { describe, expect, it } from "vite-plus/test";

import { canReloadForEngineUpdate, clientBundleStamp, engineBuildIsNewer } from "./engineUpdate";

describe("quiet engine updates", () => {
  it("recognizes only a newer compatible build", () => {
    expect(engineBuildIsNewer("0.1.2", "0.1.1")).toBe(true);
    expect(engineBuildIsNewer("0.1.0", "0.1.1")).toBe(false);
    expect(engineBuildIsNewer("dev", "0.1.1")).toBe(false);
    expect(engineBuildIsNewer("0.1.1", "0.1.1", "/assets/a-new.js", "/assets/a-old.js")).toBe(true);
    expect(engineBuildIsNewer("0.1.1", "0.1.1", "/assets/a.js", "/assets/a.js")).toBe(false);
  });

  it("uses hashed entry assets as the loaded client stamp", () => {
    expect(clientBundleStamp(["/simple/assets/app-ab12.js", null, "/plain/app.js"])).toBe(
      "/simple/assets/app-ab12.js",
    );
  });

  it("waits until there is no running work or unsent text", () => {
    expect(canReloadForEngineUpdate({ hasActiveRun: false, hasUnsentText: false })).toBe(true);
    expect(canReloadForEngineUpdate({ hasActiveRun: true, hasUnsentText: false })).toBe(false);
    expect(canReloadForEngineUpdate({ hasActiveRun: false, hasUnsentText: true })).toBe(false);
  });
});
