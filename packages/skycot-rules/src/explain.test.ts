import { describe, expect, it } from "vite-plus/test";

import {
  EXPLAIN_INSTRUCTIONS,
  EXPLAIN_OFF_MARKER,
  EXPLAIN_ON_MARKER,
  explainMarkerFor,
  parseExplanation,
  readExplainMarker,
  withExplainMarker,
} from "./explain.ts";

describe("explain markers", () => {
  it("sends a marker only when the choice is not the default", () => {
    expect(explainMarkerFor(true, true)).toBeNull();
    expect(explainMarkerFor(false, false)).toBeNull();
    expect(explainMarkerFor(false, true)).toBe(EXPLAIN_OFF_MARKER);
    expect(explainMarkerFor(true, false)).toBe(EXPLAIN_ON_MARKER);
  });

  it("round-trips through the message text", () => {
    const sent = withExplainMarker("Make the button bigger", true, false);
    expect(sent).toBe(`Make the button bigger\n\n${EXPLAIN_ON_MARKER}`);
    expect(readExplainMarker(sent)).toEqual({ text: "Make the button bigger", choice: "on" });
    expect(readExplainMarker(withExplainMarker("Hi", false, true))).toEqual({
      text: "Hi",
      choice: "off",
    });
    expect(withExplainMarker("Hi", true, true)).toBe("Hi");
  });

  it("reads only a marker at the very end", () => {
    const text = `Put ${EXPLAIN_ON_MARKER} on the page as a title`;
    expect(readExplainMarker(text)).toEqual({ text, choice: null });
    expect(readExplainMarker("plain")).toEqual({ text: "plain", choice: null });
  });

  it("asks for the exact headings the parser reads", () => {
    expect(EXPLAIN_INSTRUCTIONS).toContain("**How I did it:**");
    expect(EXPLAIN_INSTRUCTIONS).toContain("**Double-check:**");
  });
});

describe("parseExplanation", () => {
  it("lifts the requested form out of the message", () => {
    const text = [
      "I changed the footer to say Made with SKYCOT.",
      "",
      "**How I did it:** I found the footer tag at the bottom of the page and swapped its words. A footer is like the last line of a letter.",
      "**Double-check:** I opened the page and read the new footer.",
    ].join("\n");
    expect(parseExplanation(text)).toEqual({
      body: "I changed the footer to say Made with SKYCOT.",
      how: "I found the footer tag at the bottom of the page and swapped its words. A footer is like the last line of a letter.",
      check: "I opened the page and read the new footer.",
    });
  });

  it("accepts headings, bullets, a rule above and no check", () => {
    expect(
      parseExplanation(
        "Done!\n\n---\n## How I did it\nI used a button tag — it's like a light switch.",
      ),
    ).toEqual({
      body: "Done!",
      how: "I used a button tag — it's like a light switch.",
      check: null,
    });
    expect(
      parseExplanation(
        "Done.\n\nHow I did it: I added a colour.\n- **Double-checked:** I looked at it.",
      ),
    ).toEqual({ body: "Done.", how: "I added a colour.", check: "I looked at it." });
  });

  it("takes the last heading when the phrase appears earlier", () => {
    const parsed = parseExplanation(
      "You asked how I did that earlier.\n\n**How I did that:** I moved the picture.",
    );
    expect(parsed?.how).toBe("I moved the picture.");
    expect(parsed?.body).toBe("You asked how I did that earlier.");
  });

  it("is null when the section is missing or empty", () => {
    expect(parseExplanation("I changed the footer.")).toBeNull();
    expect(parseExplanation("I changed it.\n\n**How I did it:**")).toBeNull();
    expect(parseExplanation("")).toBeNull();
  });

  it("copes with a section still streaming in", () => {
    expect(parseExplanation("Done.\n\n**How I did it:** I used a")).toEqual({
      body: "Done.",
      how: "I used a",
      check: null,
    });
  });
});
