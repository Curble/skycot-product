import { describe, expect, it } from "vite-plus/test";

import {
  RESTART_UNLOCK_TTL_MS,
  encodeRestartUnlock,
  familyProfileOn,
  restartUnlockAllows,
} from "./updateRestart.ts";

const NOW = 1_800_000_000_000;

describe("the Family profile's restart rule", () => {
  it("reads whether the profile is on, failing closed", () => {
    expect(familyProfileOn(null)).toBe(false);
    expect(familyProfileOn(JSON.stringify({ version: 2, enabled: false }))).toBe(false);
    expect(familyProfileOn(JSON.stringify({ version: 2, enabled: true }))).toBe(true);
    expect(familyProfileOn("{ half a file")).toBe(true);
  });

  it("allows only the agreed version, only for a short while", () => {
    const note = encodeRestartUnlock({ version: "1.4.0", expiresAt: NOW + RESTART_UNLOCK_TTL_MS });
    expect(restartUnlockAllows(note, "1.4.0", NOW)).toBe(true);
    expect(restartUnlockAllows(note, "1.5.0", NOW)).toBe(false);
    expect(restartUnlockAllows(note, null, NOW)).toBe(false);
    expect(restartUnlockAllows(note, "1.4.0", NOW + RESTART_UNLOCK_TTL_MS + 1)).toBe(false);
    expect(restartUnlockAllows(null, "1.4.0", NOW)).toBe(false);
  });

  it("refuses a note dated far ahead or not written by the engine", () => {
    const far = encodeRestartUnlock({ version: "1.4.0", expiresAt: NOW + 24 * 60 * 60_000 });
    expect(restartUnlockAllows(far, "1.4.0", NOW)).toBe(false);
    expect(restartUnlockAllows("yes please", "1.4.0", NOW)).toBe(false);
  });
});
