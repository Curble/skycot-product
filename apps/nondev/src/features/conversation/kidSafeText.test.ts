import { describe, expect, it } from "vite-plus/test";

import { kidSafeText } from "./kidSafeText";

describe("kidSafeText", () => {
  it("hides code, addresses and developer wording while keeping the sentence", () => {
    expect(
      kidSafeText(
        "Sam checked `src/app.ts` at https://example.com and is letting SKYCOT pause for approval.",
      ),
    ).toBe("Sam checked a project file at a website and is asking a grown-up for help.");
  });
});
