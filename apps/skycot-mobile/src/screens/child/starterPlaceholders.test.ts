// nondev-seam: skycot-iphone-q39-starter-placeholders-test
import { describe, expect, it } from "vite-plus/test";

import { starterPlaceholders } from "./starterPlaceholders";

describe("starter placeholders", () => {
  it("returns selectable bracketed words in order", () => {
    expect(starterPlaceholders("Make a [pet] called [name]")).toEqual([
      { text: "[pet]", start: 7, end: 12 },
      { text: "[name]", start: 20, end: 26 },
    ]);
  });

  it("ignores empty and multi-line brackets", () => {
    expect(starterPlaceholders("[] [two\nlines] [one]")).toEqual([
      { text: "[one]", start: 15, end: 20 },
    ]);
  });
});
