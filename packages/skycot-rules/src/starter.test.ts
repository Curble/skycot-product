// nondev-seam: beta6-starter-blank-test
import { describe, expect, it } from "vite-plus/test";

import { EXPLAIN_OFF_MARKER, readExplainMarker, withExplainMarker } from "./explain.ts";
import {
  STARTER_FILE_NAMES,
  readStarterMarker,
  starterMarker,
  starterRulesFor,
  stripStarterMarker,
  withStarterMarker,
} from "./starter.ts";

describe("starter markers", () => {
  it("round-trips through the message text", () => {
    const sent = withStarterMarker("Please make a maze game.", "game");
    expect(sent).toBe(`Please make a maze game.\n\n${starterMarker("game")}`);
    expect(readStarterMarker(sent)).toBe("game");
    expect(stripStarterMarker(sent)).toBe("Please make a maze game.");
  });

  it("sends no marker for no card or an id that is not a kids' card", () => {
    expect(withStarterMarker("my own idea", null)).toBe("my own idea");
    expect(withStarterMarker("my own idea", "not-a-card")).toBe("my own idea");
    expect(withStarterMarker("my own idea", "constructor")).toBe("my own idea");
  });

  it("reads only a marker at the very end", () => {
    const text = `Write ${starterMarker("game")} on the page`;
    expect(readStarterMarker(text)).toBeNull();
    expect(stripStarterMarker(text)).toBe(text);
  });

  it("works together with explain mode's marker, which comes last", () => {
    const sent = withExplainMarker(withStarterMarker("Make a quiz.", "quiz"), false, true);
    expect(readStarterMarker(sent)).toBe("quiz");
    expect(readExplainMarker(sent)).toEqual({ text: "Make a quiz.", choice: "off" });
    expect(sent.endsWith(EXPLAIN_OFF_MARKER)).toBe(true);
  });

  it("is taken off by the explain reader on its own too, so the plain client hides it", () => {
    expect(readExplainMarker(withStarterMarker("Hello", "pet"))).toEqual({
      text: "Hello",
      choice: null,
    });
  });
});

describe("starterRulesFor", () => {
  it("names each card's one offline file", () => {
    for (const [id, fileName] of Object.entries(STARTER_FILE_NAMES)) {
      const rules = starterRulesFor(id)!;
      expect(fileName).toMatch(/^[a-z-]+\.html$/);
      expect(rules).toContain(`one new file called ${fileName}`);
      expect(rules).toMatch(/HTML, CSS and JavaScript all inside that one file/);
      expect(rules).toMatch(/work offline/);
      expect(rules).toMatch(/no installs/);
      expect(rules).toMatch(/Do not run programs or scripts to test it/);
      expect(rules).toContain(
        "If a [blank] is left in the request, ask one short question before making anything.",
      );
    }
  });

  it("has no rules for no card or an unknown one", () => {
    expect(starterRulesFor(null)).toBeNull();
    expect(starterRulesFor("nope")).toBeNull();
  });
});
