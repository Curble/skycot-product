// nondev-seam: skycot-mobile-child-copy-test
import { describe, expect, it } from "vitest";

import { childErrorCopy, childLoadingCopy } from "./childCopy";

describe("child screen copy", () => {
  it("keeps technical failures kind and gives one next step", () => {
    expect(childErrorCopy(new Error("ECONNREFUSED 127.0.0.1"))).toBe(
      "That didn't work just now. Check your Mac is awake, then try again.",
    );
  });

  it("offers a sentence only after a wait becomes unusually long", () => {
    expect(childLoadingCopy(11_999)).toBeNull();
    expect(childLoadingCopy(12_000)).toBe("This is taking a little while.");
  });
});
