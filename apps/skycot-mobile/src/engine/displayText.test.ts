// nondev-seam: skycot-iphone-q39-display-text-test
import { describe, expect, it } from "vite-plus/test";

import { visibleMessageText } from "./displayText";

describe("message text shown to a child", () => {
  it("removes multiple and nested hidden tags while keeping the message", () => {
    expect(visibleMessageText("Make [SKYCOT: starter pet] [SKYCOT: [nested rule]] please.")).toBe(
      "Make please.",
    );
  });

  it("keeps ordinary brackets and incomplete tag text", () => {
    expect(visibleMessageText("Make [a pet] and [SKYCOT: unfinished")).toBe(
      "Make [a pet] and [SKYCOT: unfinished",
    );
  });
});
