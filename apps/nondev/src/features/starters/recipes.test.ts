import { describe, expect, it } from "vite-plus/test";

import { blankCount, choicesFor, fillBlanks } from "./choices";
import { hasRecipe, exampleBlank, itemPhrase, recipeFor, recipeSentence, RECIPES } from "./recipes";
import { KID_STARTERS, stillFromStarter } from "./starters";

const withBlanks = KID_STARTERS.filter((starter) => blankCount(starter.ask) > 0);

describe("Builder recipes", () => {
  it("every kids' card with blanks has one, and Surprise me has none", () => {
    expect(RECIPES.map((recipe) => recipe.starterId).toSorted()).toEqual(
      withBlanks.map((starter) => starter.id).toSorted(),
    );
    expect(recipeFor("surprise")).toBeUndefined();
  });

  it("has a label for every blank in the card's sentence and a short checklist", () => {
    for (const starter of withBlanks) {
      const recipe = recipeFor(starter.id)!;
      expect(hasRecipe(starter.id), starter.id).toBe(true);
      expect(recipe.blanks.length).toBe(blankCount(starter.ask));
      expect(recipe.items.length).toBeGreaterThanOrEqual(6);
      expect(recipe.items.length).toBeLessThanOrEqual(10);
      expect(new Set(recipe.items.map((entry) => entry.id)).size).toBe(recipe.items.length);
      for (const entry of recipe.items) {
        expect(entry.title).not.toBe("");
        expect(entry.hint).not.toBe("");
        expect(entry.phrase).not.toBe("");
        expect(`${entry.title} ${entry.hint} ${entry.phrase}`).not.toMatch(/\bkids?\b|\d{2}/i);
        if (entry.stepper === undefined) expect(entry.phrase).not.toContain("{n}");
        else {
          expect(entry.phrase).toContain("{n}");
          expect(entry.stepper.min).toBeLessThanOrEqual(entry.stepper.start);
          expect(entry.stepper.start).toBeLessThanOrEqual(entry.stepper.max);
        }
      }
    }
  });

  it("leaves every blank empty: an empty box never puts example words in the sentence", () => {
    for (const starter of withBlanks) {
      const count = blankCount(starter.ask);
      const empty = Array.from({ length: count }, () => "");
      const sentence = recipeSentence(starter.id, empty, [
        { id: recipeFor(starter.id)!.items[0]!.id },
      ]);
      expect(sentence, starter.id).not.toMatch(/[[\]{}]/);
      expect(sentence, starter.id).not.toMatch(/\s{2,}|\s[.,:]|,\s*\./);
      const placeholders = [
        ...choicesFor(starter.id).flatMap((set) => set.choices.map((choice) => choice.label)),
        ...[...starter.ask.matchAll(/\[([^\]\n]+)\]/g)].map((match) => match[1]!),
        ...recipeFor(starter.id)!.blanks.map((_, i) => exampleBlank(starter.id, i)),
      ];
      for (const text of placeholders) {
        const pattern = new RegExp(
          `(^|[^\\w])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`,
        );
        expect(sentence, `${starter.id}: ${text}`).not.toMatch(pattern);
      }
    }
  });

  it("reads well for every mix of filled and empty boxes", () => {
    for (const starter of withBlanks) {
      const count = blankCount(starter.ask);
      for (let mask = 0; mask < 1 << count; mask++) {
        const blanks = Array.from({ length: count }, (_, i) => (mask & (1 << i) ? `word${i}` : ""));
        const sentence = recipeSentence(starter.id, blanks, []);
        expect(sentence, `${starter.id} ${mask}`).toMatch(/^[A-Z].*[.!”]$/);
        expect(sentence).not.toMatch(/\s{2,}|\s[.,:]|,\s*\.|[[\]]/);
        blanks.forEach((word, i) => {
          if (word) expect(sentence).toContain(word);
        });
      }
    }
  });

  it("writes the birthday card for empty, one filled and all filled boxes", () => {
    const rest =
      " Make it bright and happy with balloons, a big “Happy birthday!”, and a button that makes confetti pop.";
    expect(recipeSentence("birthday", ["", ""], [])).toBe(
      `Please make a birthday card page.${rest}`,
    );
    expect(recipeSentence("birthday", ["my Nan", ""], [])).toBe(
      `Please make a birthday card page for my Nan.${rest}`,
    );
    expect(recipeSentence("birthday", ["", "7"], [])).toBe(
      `Please make a birthday card page for someone who is turning 7.${rest}`,
    );
    expect(recipeSentence("birthday", ["Dad", "40"], [])).toBe(
      `Please make a birthday card page for Dad, who is turning 40.${rest}`,
    );
    expect(recipeSentence("birthday", ["  ", " "], [{ id: "gift" }])).toBe(
      `Please make a birthday card page.${rest} Also add: a gift box that opens.`,
    );
  });

  it("writes the ticked parts as one 'Also add' sentence, in the recipe's order", () => {
    const sentence = recipeSentence(
      "game",
      ["catch the falling stars"],
      [{ id: "two" }, { id: "levels" }, { id: "sounds" }, { id: "timer", amount: 60 }],
    );
    expect(sentence).toBe(
      "Please make a simple game I can play in the page: catch the falling stars. Use the arrow keys or the mouse, keep score, and show a big “Play again” button at the end. Also add: levels that get harder, sound effects, a 60-second timer, and a two-player mode.",
    );
    expect(recipeSentence("game", ["a maze"], [{ id: "lives" }])).toContain(
      "Also add: three lives.",
    );
    expect(recipeSentence("game", ["a maze"], [{ id: "lives" }, { id: "music" }])).toContain(
      "Also add: three lives and a tune that plays while I play.",
    );
    expect(recipeSentence("game", ["a maze"], [])).not.toContain("Also add");
  });

  it("uses the stepper's number, or its start when none was set", () => {
    const timer = recipeFor("game")!.items.find((entry) => entry.id === "timer")!;
    expect(itemPhrase(timer, 90)).toBe("a 90-second timer");
    expect(itemPhrase(timer, undefined)).toBe("a 60-second timer");
  });

  it("every part icon asks for the full-colour picture", () => {
    for (const recipe of RECIPES) {
      for (const entry of recipe.items) expect(entry.art, entry.id).toContain("\uFE0F");
    }
  });

  it("with every box filled, reads exactly like the card's own sentence", () => {
    for (const starter of withBlanks) {
      const blanks = Array.from({ length: blankCount(starter.ask) }, (_, i) => `word${i}`);
      expect(recipeSentence(starter.id, blanks, []), starter.id).toBe(
        fillBlanks(starter.ask, blanks),
      );
    }
  });

  it("keeps the card's own words so the hidden marker still applies", () => {
    for (const starter of withBlanks) {
      const recipe = recipeFor(starter.id)!;
      const blanks = recipe.blanks.map((_, i) => exampleBlank(starter.id, i));
      const plain = recipeSentence(starter.id, blanks, []);
      const full = recipeSentence(
        starter.id,
        blanks,
        recipe.items.slice(0, 3).map((entry) => ({ id: entry.id })),
      );
      expect(stillFromStarter(plain, full), starter.id).toBe(true);
    }
  });
});
