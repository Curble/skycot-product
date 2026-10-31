import { describe, expect, it } from "vite-plus/test";

import {
  findMatches,
  findSpans,
  matchCountLabel,
  splitHighlights,
  stepMatch,
} from "./findInConversation";

describe("findSpans", () => {
  it("ignores capitals and finds every spot", () => {
    expect(findSpans("Cat, cat, CAT", "cat")).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 8 },
      { start: 10, end: 13 },
    ]);
  });
  it("finds nothing for an empty or blank word", () => {
    expect(findSpans("hello", "")).toEqual([]);
    expect(findSpans("hello", "   ")).toEqual([]);
  });
  it("does not overlap matches", () => {
    expect(findSpans("aaaa", "aa")).toHaveLength(2);
  });
});

describe("findMatches", () => {
  it("lists matches message by message in reading order", () => {
    const hits = findMatches(["no", "a dog and a Dog", "dog"], "dog");
    expect(hits.map((hit) => hit.index)).toEqual([1, 1, 2]);
  });
});

describe("splitHighlights", () => {
  it("cuts a text into pieces that join back into the text", () => {
    const pieces = splitHighlights("My Dog saw a dog", "dog");
    expect(pieces.map((piece) => piece.text).join("")).toBe("My Dog saw a dog");
    expect(pieces.filter((piece) => piece.match).map((piece) => piece.text)).toEqual([
      "Dog",
      "dog",
    ]);
  });
  it("returns the whole text when nothing matches", () => {
    expect(splitHighlights("hello", "xyz")).toEqual([{ text: "hello", match: false }]);
    expect(splitHighlights("", "x")).toEqual([]);
  });
});

describe("stepMatch", () => {
  it("wraps round at both ends", () => {
    expect(stepMatch(4, 5, 1)).toBe(0);
    expect(stepMatch(0, 5, -1)).toBe(4);
    expect(stepMatch(1, 5, 1)).toBe(2);
  });
  it("starts at the first or last match and handles none", () => {
    expect(stepMatch(null, 3, 1)).toBe(0);
    expect(stepMatch(null, 3, -1)).toBe(2);
    expect(stepMatch(null, 0, 1)).toBeNull();
  });
});

describe("matchCountLabel", () => {
  it("speaks plainly", () => {
    expect(matchCountLabel("", null, 0)).toBe("");
    expect(matchCountLabel("dog", null, 0)).toBe("No matches");
    expect(matchCountLabel("dog", 1, 5)).toBe("2 of 5");
  });
});
