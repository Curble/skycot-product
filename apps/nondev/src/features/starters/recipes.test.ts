import { describe, expect, it } from "vite-plus/test";

import { blankCount, choicesFor } from "./choices";
import { hasRecipe, initialBlank, itemPhrase, recipeFor, recipeSentence, RECIPES } from "./recipes";
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

  it("starts each blank with a real choice, so the sentence never has a hole", () => {
    for (const starter of withBlanks) {
      for (let i = 0; i < blankCount(starter.ask); i++) {
        expect(initialBlank(starter.id, i), `${starter.id} ${i}`).not.toBe("");
      }
      const sentence = recipeSentence(
        starter.id,
        choicesFor(starter.id).map((_, i) => initialBlank(starter.id, i)),
        [],
      );
      expect(sentence).not.toMatch(/[[\]{}]/);
    }
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

  it("keeps the card's own words so the hidden marker still applies", () => {
    for (const starter of withBlanks) {
      const recipe = recipeFor(starter.id)!;
      const blanks = recipe.blanks.map((_, i) => initialBlank(starter.id, i));
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
