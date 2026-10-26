import { describe, expect, it } from "vite-plus/test";

// nondev-seam: skycot-mobile-child-request-copy-test

import { childRequestWaitingCopy } from "./childRequestCopy";

describe("child request waiting copy", () => {
  it("explains who answers and clears when the request is answered", () => {
    expect(childRequestWaitingCopy("Sam wants to install an add-on.", true)).toBe(
      "Sam wants to install an add-on. A grown-up will answer on their phone. This card updates when they do.",
    );
    expect(childRequestWaitingCopy("Sam wants to install an add-on.", false)).toBeNull();
  });
});
