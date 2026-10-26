// nondev-seam: skycot-iphone-q45-face-id-settings-test
import { describe, expect, it } from "vite-plus/test";

import { faceIdRowAction } from "./faceIdRow";

describe("the grown-up Face ID row", () => {
  it("offers Settings when biometrics exist but are switched off", () => {
    expect(faceIdRowAction(false, false)).toBe("settings");
    expect(faceIdRowAction(true, false)).toBe("set-up");
    expect(faceIdRowAction(true, true)).toBeNull();
  });
});
