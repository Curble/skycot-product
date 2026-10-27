import { describe, expect, it } from "vite-plus/test";

import { kidSafePlan, kidSafeText } from "./kidSafeText";

describe("kidSafeText", () => {
  it("hides code, addresses and developer wording while keeping the sentence", () => {
    expect(
      kidSafeText(
        "Sam checked `src/app.ts` at https://example.com and is letting SKYCOT pause for approval.",
      ),
    ).toBe(
      "Sam checked something behind the scenes at a website and is asking a grown-up for help.",
    );
  });

  it("turns common developer words into child words", () => {
    expect(kidSafeText("The server changed a file in the project folder.")).toBe(
      "The things changed a things in the project things.",
    );
  });

  it("removes markdown markers that the phone cannot render", () => {
    expect(kidSafeText("**How I did it:** I drew a box.")).toBe("How I did it: I drew a box.");
  });
});

describe("kidSafePlan", () => {
  it("shows only numbered steps in kid words", () => {
    expect(
      kidSafePlan(
        "CONTEXT\nPLAN\n1. Draw a big star.\n2. Run `node test.mjs` and check the page.\nTHINGS\nVerification: done",
      ),
    ).toBe("1. Draw a big star.\n2. Run something behind the scenes and check the page.");
  });
});
