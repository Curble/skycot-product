import { describe, expect, it } from "vite-plus/test";

import {
  STARTER_FILE_NAMES,
  readStarterMarker,
  starterRulesFor,
} from "@t3tools/skycot-rules/starter";

import {
  GROWN_UP_RULES,
  GROWN_UP_STARTERS,
  KID_STARTERS,
  SURPRISE_IDEAS,
  firstBlank,
  freshProjectName,
  pickSurprise,
  starterMessageText,
  starterPrompt,
  startersFor,
  startsFreshProject,
  stillFromStarter,
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

  it("shows a child only the friendly sentence, with no developer words", () => {
    for (const starter of KID_STARTERS) {
      const prompt = starterPrompt(starter, () => 0);
      expect(prompt).toBe(starter.ask.replace("{idea}", SURPRISE_IDEAS[0]!));
      expect(prompt).not.toMatch(/\.html|HTML|CSS|JavaScript|offline|no installs|new file/i);
    }
  });

  it("names the same one file as the engine's rules for every kid card", () => {
    expect(KID_STARTERS.map((starter) => starter.id).toSorted()).toEqual(
      Object.keys(STARTER_FILE_NAMES).toSorted(),
    );
    for (const starter of KID_STARTERS) {
      expect(starter.fileName).toBe(STARTER_FILE_NAMES[starter.id]);
      expect(starterRulesFor(starter.id)).toContain(`one new file called ${starter.fileName}`);
    }
  });

  it("sends the card's rules as a hidden marker while the words are still the card's", () => {
    const game = KID_STARTERS.find((starter) => starter.id === "game")!;
    const prompt = starterPrompt(game);
    const seed = { starterId: "game", text: prompt };
    const filled = prompt.replace(/\[[^\]]+\]/, "a maze where a penguin finds a fish");
    const sent = starterMessageText(filled, seed);
    expect(sent.startsWith(filled)).toBe(true);
    expect(readStarterMarker(sent)).toBe("game");
    // A few changed words still count as the card.
    expect(readStarterMarker(starterMessageText(filled.replace("simple", "fun"), seed))).toBe(
      "game",
    );
  });

  it("sends no marker when the child cleared the box and typed their own idea", () => {
    const game = KID_STARTERS.find((starter) => starter.id === "game")!;
    const seed = { starterId: "game", text: starterPrompt(game) };
    expect(starterMessageText("make me a game about dogs", seed)).toBe("make me a game about dogs");
    expect(starterMessageText("", seed)).toBe("");
    expect(stillFromStarter(seed.text, "hello")).toBe(false);
    expect(starterMessageText("anything", null)).toBe("anything");
  });

  it("sends no marker for a grown-up card, which shows its own rules", () => {
    const form = GROWN_UP_STARTERS[0]!;
    const text = starterPrompt(form);
    expect(starterMessageText(text, { starterId: form.id, text })).toBe(text);
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
    expect(SURPRISE_IDEAS.join(" ")).not.toContain("Web Audio API");
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

describe("a starter card starts a project of its own", () => {
  const seed = { text: seedText() };
  function seedText() {
    return starterPrompt(KID_STARTERS.find((card) => card.id === "birthday")!);
  }

  it("is fresh for a child who tapped a card and picked no project", () => {
    expect(startsFreshProject({ childView: true, seed, text: seed.text, chosenKey: null })).toBe(
      true,
    );
  });

  it("is not fresh when the project was picked by hand, or the box holds their own words", () => {
    expect(startsFreshProject({ childView: true, seed, text: seed.text, chosenKey: "e:p" })).toBe(
      false,
    );
    expect(
      startsFreshProject({ childView: true, seed, text: "fix my snake game", chosenKey: null }),
    ).toBe(false);
  });

  it("is not fresh without a card, or for a grown-up", () => {
    expect(startsFreshProject({ childView: true, seed: null, text: "hi", chosenKey: null })).toBe(
      false,
    );
    expect(startsFreshProject({ childView: false, seed, text: seed.text, chosenKey: null })).toBe(
      false,
    );
  });

  it("names the project from the card and never repeats a name", () => {
    expect(freshProjectName("A birthday card", [])).toBe("Birthday card");
    expect(freshProjectName("Make a game", [])).toBe("Game");
    expect(freshProjectName("A birthday card", ["Birthday card", "birthday card 2"])).toBe(
      "Birthday card 3",
    );
  });
});
