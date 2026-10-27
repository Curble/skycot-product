// nondev-seam: skycot-iphone-q39-starter-placeholders-test
import { describe, expect, it } from "vite-plus/test";
import { readStarterMarker } from "@t3tools/skycot-rules/starter";

import {
  replaceSelectedStarterText,
  selectStarterPlaceholder,
  starterPlaceholders,
} from "./starterPlaceholders";
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

  it("replaces tapped chips in sequence and sends only the visible words", () => {
    const starter = KID_STARTERS.find((item) => item.id === "birthday") ?? KID_STARTERS[0]!;
    const original = starterPrompt(starter);
    let draft = { text: original, selection: { start: 0, end: 0 } };
    const recipient = starterPlaceholders(draft.text)[0]!;
    draft = selectStarterPlaceholder(draft.text, recipient.start, recipient.end);
    draft = replaceSelectedStarterText(draft.text, draft.selection, "for my Nan");
    const age = starterPlaceholders(draft.text)[0]!;
    draft = selectStarterPlaceholder(draft.text, age.start, age.end);
    draft = replaceSelectedStarterText(draft.text, draft.selection, "70");

    const sent = starterMessageText(draft.text, { starterId: starter.id, text: original });
    expect(visibleMessageText(sent)).toBe(draft.text);
    expect(draft.text).not.toMatch(/\[[^\]]+\]/u);
  });
});
