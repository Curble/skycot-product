// nondev-seam: skycot-iphone-q45-face-id-settings-test
import { describe, expect, it } from "vite-plus/test";

import { faceIdRowAction, faceIdRowSubtitle } from "./faceIdRow";

describe("the grown-up Face ID row", () => {
  it("offers Settings when biometrics exist but are switched off", () => {
    expect(faceIdRowAction(false, false)).toBe("settings");
    expect(faceIdRowAction(true, false)).toBe("set-up");
    expect(faceIdRowAction(true, true)).toBeNull();
  });

  it("keeps the Settings row text short enough to fit beside its button", () => {
    expect(faceIdRowSubtitle({ label: "Face ID", available: false, everywhere: false })).toBe(
      "Turn on Face ID in Settings to use it here. Parent code still works.",
    );
  });
});
