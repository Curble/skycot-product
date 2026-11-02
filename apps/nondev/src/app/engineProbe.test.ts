import { describe, expect, it } from "vite-plus/test";

import { ENGINE_PROBE_INTERVAL_MS, ENGINE_WAKE_COOLDOWN_MS, shouldWake } from "./engineProbe";

describe("engine probe wakeup", () => {
  it("does nothing while the engine is not answering", () => {
    expect(shouldWake(false, null, 1000)).toBe(false);
  });

  it("wakes the connection the first time the engine answers", () => {
    expect(shouldWake(true, null, 1000)).toBe(true);
  });

  it("waits out the cooldown before waking again", () => {
    expect(shouldWake(true, 1000, 1000 + ENGINE_WAKE_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldWake(true, 1000, 1000 + ENGINE_WAKE_COOLDOWN_MS)).toBe(true);
  });

  it("checks far more often than the old retry back-off", () => {
    expect(ENGINE_PROBE_INTERVAL_MS).toBeLessThanOrEqual(5000);
  });
});
