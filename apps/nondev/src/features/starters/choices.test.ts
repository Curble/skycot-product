import { describe, expect, it } from "vite-plus/test";

import { blankCount, choicesFor, fillBlanks, hasPicker, pickRandom, shownLabel } from "./choices";
import { KID_STARTERS } from "./starters";

describe("step picker choices", () => {
  it("has one set of tiles per blank of every kid card", () => {
    for (const starter of KID_STARTERS) {
      const sets = choicesFor(starter.id);
      expect(sets.length, starter.id).toBe(blankCount(starter.ask));
      sets.forEach((set, index) => expect(set.blankIndex).toBe(index));
    }
  });

  it("gives every step at least eight short, distinct tiles and a question without ages", () => {
    for (const starter of KID_STARTERS) {
      for (const set of choicesFor(starter.id)) {
        expect(set.choices.length, `${starter.id}#${set.blankIndex}`).toBeGreaterThanOrEqual(8);
        const labels = set.choices.map((choice) => choice.label);
        expect(new Set(labels).size).toBe(labels.length);
        for (const choice of set.choices) {
          expect(choice.label.length).toBeLessThanOrEqual(24);
          expect(choice.art).not.toBe("");
        }
        expect(set.question.split(" ").length).toBeLessThanOrEqual(5);
        expect(set.question).not.toMatch(/\bage\b|\byears?\b|\bold\b|reading|level/i);
      }
    }
  });

  it("fills every blank when the first tile of each step is used", () => {
    for (const starter of KID_STARTERS) {
      const filled = fillBlanks(
        starter.ask,
        choicesFor(starter.id).map((set) => set.choices[0]!.label),
      );
      expect(filled, starter.id).not.toContain("[");
    }
  });

  it("opens the picker only for cards that have blanks", () => {
    expect(hasPicker("game")).toBe(true);
    expect(hasPicker("draw")).toBe(true);
    expect(hasPicker("surprise")).toBe(false);
    expect(hasPicker("contact-form")).toBe(false);
  });

  it("fills blanks in order and leaves missing answers as they are", () => {
    const ask = "A [kind] called [name] who is [number].";
    expect(fillBlanks(ask, ["dog", "Max", "7"])).toBe("A dog called Max who is 7.");
    expect(fillBlanks(ask, ["dog"])).toBe("A dog called [name] who is [number].");
    expect(fillBlanks(ask, ["dog", null, "  "])).toBe("A dog called [name] who is [number].");
  });

  it("picks at random, clamped to the list", () => {
    const list = ["a", "b", "c"];
    expect(pickRandom(list, () => 0)).toBe("a");
    expect(pickRandom(list, () => 0.5)).toBe("b");
    expect(pickRandom(list, () => 0.999)).toBe("c");
    expect(pickRandom(list, () => 1)).toBe("c");
    expect(pickRandom(list, () => -1)).toBe("a");
  });

  it("capitalises a label for display only", () => {
    expect(shownLabel("my Nan")).toBe("My Nan");
    expect(shownLabel("Biscuit")).toBe("Biscuit");
  });
});
