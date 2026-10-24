import { assert, describe, it } from "@effect/vitest";
import { EXPLAIN_INSTRUCTIONS } from "@t3tools/skycot-rules/explain";
import { STARTER_FILE_NAMES, starterRulesFor } from "@t3tools/skycot-rules/starter";

import { CONTINUE_TEXT } from "./model-fallback/SkycotModelFallback.ts";
import { becauseFor, noteForAssistant, noteForDownload } from "./SkycotApprovedInstalls.ts";
import { familyReadingLevel, wrapTurnText } from "./SkycotFamilyInstructions.ts";

// What SKYCOT tells an AI service describes how to talk and what is allowed, never who the user
// is. "Explain it the way you would to a 9-year-old" is a style request; "the user is a 9-year-old
// child" is personal information about them (Mark, 25 October 2026).
const STYLE_EXAMPLES = [
  /the way you would to a \d+-year-old/g,
  /words a \d+-year-old understands/g,
];
const ABOUT_THE_USER =
  /\b(?:child|children|kids?|parents?|grown-?ups?|minors?|ages?|toddlers?|teen(?:ager)?s?|family|son|daughter)\b|years?[- ]old/i;

function aboutTheUser(text: string): string | null {
  const withoutStyle = STYLE_EXAMPLES.reduce((rest, pattern) => rest.replace(pattern, ""), text);
  return ABOUT_THE_USER.exec(withoutStyle)?.[0] ?? null;
}

describe("words SKYCOT sends to an AI service", () => {
  it("never say who the user is or how old they are", () => {
    const levels = [
      familyReadingLevel([{ readingLevel: "little-makers" }]),
      familyReadingLevel([{ readingLevel: "makers" }]),
      familyReadingLevel([{ readingLevel: "big-makers" }]),
    ];
    const install = { manager: "npm", packages: ["three"], dev: false } as const;
    const download = { url: "https://unpkg.com/three/build/three.module.js", output: "three.js" };
    const reliefs = [undefined, "trusted-add-on", "approved-before"];
    const texts = [
      ...levels.map((readingLevel) =>
        wrapTurnText("make a maze game", {
          family: true,
          explain: true,
          hidden: ["full-name"],
          plan: true,
          readingLevel,
          starter: Object.keys(STARTER_FILE_NAMES)[0]!,
        }),
      ),
      ...Object.keys(STARTER_FILE_NAMES).map((id) => starterRulesFor(id) ?? ""),
      ...reliefs.flatMap((relief) => [
        noteForAssistant(install, { ok: true }, becauseFor(relief)),
        noteForAssistant(install, { ok: false, reason: "it took too long." }, becauseFor(relief)),
        noteForDownload(download, { ok: true }, becauseFor(relief)),
      ]),
      EXPLAIN_INSTRUCTIONS,
      CONTINUE_TEXT,
    ];
    for (const text of texts) {
      // The user's own words ("make a maze game") are theirs; everything else is SKYCOT's.
      const found = aboutTheUser(text.replace("make a maze game", ""));
      assert.isNull(found, `"${found}" in: ${text.slice(0, 400)}`);
    }
  });

  it("asks for a style matched to the reading level", () => {
    const text = wrapTurnText("hi", {
      family: true,
      explain: false,
      readingLevel: familyReadingLevel([{ readingLevel: "little-makers" }]),
    });
    assert.include(text, "the way you would to a 6-year-old");
  });
});
