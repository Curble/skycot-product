// nondev-seam: skycot-iphone-q39-requests-copy-test
import { describe, expect, it } from "vite-plus/test";

import { NOTIFICATION_INTRO, requestCountSentence } from "./requestsCopy";

describe("grown-up request count copy", () => {
  it("does not say nothing is needed when a family note can still be shown", () => {
    expect(requestCountSentence(0)).toBeNull();
    expect(requestCountSentence(1)).toBe("1 request needs a grown-up.");
    expect(requestCountSentence(3)).toBe("3 requests need a grown-up.");
  });

  it("explains private request alerts before asking iOS for permission", () => {
    expect(NOTIFICATION_INTRO.message).toContain("when a child needs help");
    expect(NOTIFICATION_INTRO.message).toContain("without including what they wrote");
    expect(NOTIFICATION_INTRO.button).toBe("Turn on alerts");
  });
});
