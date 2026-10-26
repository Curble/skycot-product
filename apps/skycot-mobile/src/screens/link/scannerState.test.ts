import { describe, expect, it } from "vite-plus/test";

import { scannerMessage } from "./scannerState";

// nondev-seam: skycot-mobile-link-scanner-state-test

describe("scanner status", () => {
  it("distinguishes camera startup, scanning and linking", () => {
    expect(
      scannerMessage({ granted: false, canAskAgain: true, cameraReady: false, busy: false }),
    ).toBe("Camera starting…");
    expect(
      scannerMessage({ granted: true, canAskAgain: true, cameraReady: false, busy: false }),
    ).toBe("Camera starting…");
    expect(
      scannerMessage({ granted: true, canAskAgain: true, cameraReady: true, busy: false }),
    ).toBe("Looking for the code…");
    expect(
      scannerMessage({ granted: true, canAskAgain: true, cameraReady: true, busy: true }),
    ).toBe("Linking…");
  });
});
