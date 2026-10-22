import { describe, expect, it } from "vite-plus/test";

import {
  GROWN_UP_RULES,
  GROWN_UP_STARTERS,
  KID_STARTERS,
  SURPRISE_IDEAS,
  firstBlank,
  pickSurprise,
  starterPrompt,
  startersFor,
} from "./starters";

describe("starter cards", () => {
  it("offers 6 to 8 cards per audience, each with a unique id", () => {
    for (const set of [KID_STARTERS, GROWN_UP_STARTERS]) {
      expect(set.length).toBeGreaterThanOrEqual(6);
      expect(set.length).toBeLessThanOrEqual(8);
      expect(new Set(set.map((starter) => starter.id)).size).toBe(set.length);
    }
  });

  it("has the eight kid cards the brief names, in order", () => {
    expect(KID_STARTERS.map((starter) => starter.title)).toEqual([
      "Make a game",
      "A page about my pet",
      "A birthday card",
      "My school project",
      "A comic strip",
      "A quiz for my friends",
      "Draw it, then build it",
      "Surprise me",
    ]);
  });

  it("shows the kids' set for a Family profile or a playful theme, the business set otherwise", () => {
    expect(startersFor({ family: true, playful: false })).toBe(KID_STARTERS);
    expect(startersFor({ family: false, playful: true })).toBe(KID_STARTERS);
    expect(startersFor({ family: false, playful: false })).toBe(GROWN_UP_STARTERS);
  });

  it("asks every kid starter for one offline file with no installs", () => {
    for (const starter of KID_STARTERS) {
      const prompt = starterPrompt(starter, () => 0);
      expect(starter.fileName).toMatch(/^[a-z-]+\.html$/);
      expect(prompt).toContain(`one new file called ${starter.fileName}`);
      expect(prompt).toMatch(/HTML, CSS and JavaScript all inside that one file/);
      expect(prompt).toMatch(/work offline/);
      expect(prompt).toMatch(/no internet/);
      expect(prompt).toMatch(/no installs/);
    }
  });

  it("never asks a child for personal details such as a real name or school", () => {
    for (const starter of KID_STARTERS) {
      const prompt = starterPrompt(starter, () => 0);
      expect(prompt).not.toMatch(/\[(your|my) (full )?name\]|school name|address|phone number/i);
    }
  });

  it("keeps grown-up prompts to the files already there and asks for a plan first", () => {
    for (const starter of GROWN_UP_STARTERS) {
      const prompt = starterPrompt(starter);
      expect(prompt.endsWith(GROWN_UP_RULES)).toBe(true);
      expect(prompt).toMatch(/No installs/);
    }
  });

  it("puts a surprise idea in place of the placeholder", () => {
    const surprise = KID_STARTERS.find((starter) => starter.kind === "surprise")!;
    expect(starterPrompt(surprise, () => 0)).toContain(`Please make ${SURPRISE_IDEAS[0]}.`);
    expect(starterPrompt(surprise, () => 0.9999)).toContain(SURPRISE_IDEAS.at(-1)!);
    expect(starterPrompt(surprise, () => 0)).not.toContain("{idea}");
  });

  it("clamps a random source that strays out of range", () => {
    expect(pickSurprise(() => 1)).toBe(SURPRISE_IDEAS.at(-1));
    expect(pickSurprise(() => -0.5)).toBe(SURPRISE_IDEAS[0]);
  });

  it("finds the first blank so the composer can select it", () => {
    const text = starterPrompt(KID_STARTERS.find((starter) => starter.id === "pet")!);
    const blank = firstBlank(text)!;
    expect(text.slice(blank.start, blank.end)).toBe("[kind of animal]");
    expect(firstBlank("No blanks here.")).toBeNull();
  });

  it("gives every prompt-filling card at least one blank to fill, except the open-ended ones", () => {
    const withoutBlanks = [...KID_STARTERS, ...GROWN_UP_STARTERS]
      .filter((starter) => firstBlank(starter.ask) === null)
      .map((starter) => starter.id);
    expect(withoutBlanks).toEqual(["surprise", "phones", "polish"]);
  });
});
