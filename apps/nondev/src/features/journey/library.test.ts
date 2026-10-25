import { withStarterMarker } from "@t3tools/skycot-rules/starter";
import { describe, expect, it } from "vite-plus/test";

import { BUILD_WORDS, chooseBuildWord, explanationFor, journeyIsGame, wordFor } from "./library";

const STEPS = ["Think it through", "Make a plan", "Build it", "Test it", "Finish"] as const;
const LEVELS = ["little-makers", "makers", "big-makers"] as const;

describe("Build Journey library", () => {
  it("has its own words for every step at every reading level", () => {
    for (const step of STEPS) {
      // Little makers: one short sentence.
      expect(explanationFor(step, "little-makers").now.split(" ").length).toBeLessThanOrEqual(10);
      for (const level of LEVELS) {
        const copy = explanationFor(step, level);
        expect(copy.question.length).toBeGreaterThan(0);
        expect(copy.answers.length).toBeGreaterThanOrEqual(2);
        for (const answer of copy.answers) expect(answer.say.length).toBeGreaterThan(0);
      }
      // The levels really differ, not one sentence with words bolted on.
      const nows = new Set(LEVELS.map((level) => explanationFor(step, level).now));
      const questions = new Set(LEVELS.map((level) => explanationFor(step, level).question));
      expect(nows.size).toBe(3);
      expect(questions.size).toBe(3);
    }
  });

  it("uses the approved Test it words", () => {
    expect(explanationFor("Test it", "little-makers").now).toBe(
      "Sam is playing your game to check it works!",
    );
    expect(explanationFor("Test it", "makers").why).toContain("Real game studios");
    expect(explanationFor("Test it", "big-makers").why).toContain(
      "new code doesn't break old code",
    );
  });

  it("uses the family's own builder name", () => {
    const copy = explanationFor("Build it", "makers", "Pip");
    expect(copy.now.startsWith("Pip is writing the code")).toBe(true);
    expect(copy.now).not.toContain("Sam");
  });

  it("explains 20 words at three levels", () => {
    expect(BUILD_WORDS).toHaveLength(20);
    expect(wordFor("collision detection", "big-makers").meaning).toContain("overlap");
    expect(wordFor("bug", "makers").meaning).toContain("moth");
  });

  it("teaches the most interesting idea the build used", () => {
    expect(chooseBuildWord({ fileNames: ["style.css"] })).toBe("style");
    expect(chooseBuildWord({ commands: ["node test.js"] })).toBe("test");
    expect(chooseBuildWord({ changedCode: "for (let i = 0; i < 5; i++) {}" })).toBe("loop");
    // Every game has a page and a style: the game idea wins.
    expect(
      chooseBuildWord({
        fileNames: ["my-game.html", "style.css"],
        changedCode: "if (penguin.x === fish.x) { score += 10 }",
      }),
    ).toBe("score");
    expect(chooseBuildWord({ changedCode: "import * as THREE from './three.module.js'" })).toBe(
      "3D",
    );
    expect(chooseBuildWord({})).toBe("plan");
  });
});

describe("game and page questions", () => {
  it("uses the request and gives starter kinds priority over incidental game words", () => {
    for (const request of ["make a game", "I want to play", "add a score", "make a new level"])
      expect(journeyIsGame(request)).toBe(true);
    for (const id of ["birthday", "pet", "quiz"])
      expect(journeyIsGame(withStarterMarker("keep score when I play", id))).toBe(false);
    expect(journeyIsGame("make a quiz and keep score")).toBe(false);
    expect(journeyIsGame("make a page about my pet")).toBe(false);
    expect(journeyIsGame(withStarterMarker("make something", "game"))).toBe(true);
  });

  it("has page copy with no winning, playing or levels at any reading level", () => {
    for (const step of ["Build it", "Test it", "Finish"] as const) {
      for (const level of LEVELS) {
        const page = explanationFor(step, level, "Pip", false);
        expect(JSON.stringify(page)).not.toMatch(
          /\b(win|winning|play|playing|players?|levels?|game)\b/i,
        );
        for (const answer of page.answers) expect(answer.say.length).toBeGreaterThan(0);
      }
    }
    expect(explanationFor("Build it", "makers", "Sam", true).answers[0]?.say).toBe(
      "Can you add confetti when I win?",
    );
  });
});
