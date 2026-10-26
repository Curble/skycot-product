// nondev-seam: skycot-iphone-q39-starter-placeholders-test
import { describe, expect, it } from "vite-plus/test";
import { readStarterMarker } from "@t3tools/skycot-rules/starter";

import { starterPlaceholders } from "./starterPlaceholders";
import {
  KID_STARTERS,
  starterMessageText,
  starterPrompt,
} from "../../../../nondev/src/features/starters/starters";
import { visibleMessageText } from "../../engine/displayText";

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

  it("sends all the visible words after a multi-character chip edit", () => {
    const starter = KID_STARTERS[0]!;
    const visibleText = starterPrompt(starter).replace(/\[[^\]]+\]/u, "for my Nan");
    const composed = starterMessageText(visibleText, {
      starterId: starter.id,
      text: starterPrompt(starter),
    });
    expect(readStarterMarker(composed)).toBe(starter.id);
    expect(visibleMessageText(composed)).toBe(visibleText);
  });
});
