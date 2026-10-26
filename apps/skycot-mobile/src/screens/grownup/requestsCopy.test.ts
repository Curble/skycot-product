// nondev-seam: skycot-iphone-q39-requests-copy-test
import { describe, expect, it } from "vite-plus/test";

import { requestCountSentence } from "./requestsCopy";

describe("grown-up request count copy", () => {
  it("does not say nothing is needed when a family note can still be shown", () => {
    expect(requestCountSentence(0)).toBeNull();
    expect(requestCountSentence(1)).toBe("1 request needs a grown-up.");
    expect(requestCountSentence(3)).toBe("3 requests need a grown-up.");
  });
});
