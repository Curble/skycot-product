import { describe, expect, it } from "vite-plus/test";

import { picturePrivacyNotice } from "./picturePrivacy";

describe("the picture privacy note", () => {
  it("names the chosen assistant and says when the picture leaves this Mac", () => {
    expect(picturePrivacyNotice("Claude")).toBe(
      "Your picture stays on this Mac until you send it. Then it goes only to Claude, the AI assistant your grown-up chose.",
    );
  });

  it("still explains the boundary while the chosen assistant is loading", () => {
    expect(picturePrivacyNotice(null)).toBe(
      "Your picture stays on this Mac until you send it. Then it goes only to the AI assistant your grown-up chose.",
    );
  });
});
