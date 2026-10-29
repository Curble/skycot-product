import { describe, expect, it } from "vite-plus/test";

import { blankCount, choicesFor, fillBlanks } from "./choices";
import { KID_STARTERS, stillFromStarter } from "./starters";
import {
  groupContent,
  groupKey,
  hasWords,
  joinWords,
  unansweredBlanks,
  WORD_PLANS,
  wordsPlanFor,
  wordsSegments,
  wordsSentence,
  type Answers,
} from "./wordChoices";

const withBlanks = KID_STARTERS.filter((starter) => blankCount(starter.ask) > 0);

/** The first chip of every blank, nothing else. */
function firstBlanks(starterId: string): Answers {
  const plan = wordsPlanFor(starterId)!;
  const answers: Record<string, string[]> = {};
  for (const step of plan.steps) {
    for (const group of step.groups) {
      if (group.kind === "blank")
        answers[groupKey(group)] = [groupContent(starterId, group).chips[0]!.label];
    }
  }
  return answers;
}

describe("Words plans", () => {
  it("every kids' card with blanks has one, and Surprise me has none", () => {
    for (const starter of withBlanks) expect(wordsPlanFor(starter.id), starter.id).toBeDefined();
    expect(WORD_PLANS.map((plan) => plan.starterId).toSorted()).toEqual(
      withBlanks.map((starter) => starter.id).toSorted(),
    );
    expect(wordsPlanFor("surprise")).toBeUndefined();
  });

  it("covers every blank in the card's sentence with a group", () => {
    for (const starter of withBlanks) {
      expect(hasWords(starter.id), starter.id).toBe(true);
      const plan = wordsPlanFor(starter.id)!;
      const keys = plan.steps.flatMap((step) => step.groups.map(groupKey));
      for (let i = 0; i < blankCount(starter.ask); i++) {
        expect(keys, `${starter.id} blank ${i}`).toContain(`b${i}`);
        expect(plan.template).toContain(`{b${i}}`);
      }
    }
  });

  it("has two or three steps ending in an optional twist, with chips for every group", () => {
    for (const plan of WORD_PLANS) {
      expect(plan.steps.length, plan.starterId).toBeGreaterThanOrEqual(2);
      expect(plan.steps.length, plan.starterId).toBeLessThanOrEqual(3);
      expect(plan.steps[plan.steps.length - 1]!.twist, plan.starterId).toBe(true);
      for (const step of plan.steps) {
        expect(step.groups.length).toBeGreaterThan(0);
        for (const group of step.groups) {
          const { question, chips } = groupContent(plan.starterId, group);
          expect(question).not.toBe("");
          expect(chips.length, `${plan.starterId}/${groupKey(group)}`).toBeGreaterThanOrEqual(3);
          expect(new Set(chips.map((chip) => chip.label)).size).toBe(chips.length);
          if (group.kind === "extra") {
            expect(plan.template).toContain(`{${group.slot}}`);
            expect(group.phrase).toContain("{}");
          }
        }
      }
    }
  });

  it("builds a finished sentence with no holes that still reads as the card's", () => {
    for (const starter of withBlanks) {
      const plan = wordsPlanFor(starter.id)!;
      const answers = firstBlanks(starter.id);
      const sentence = wordsSentence(plan, answers);
      expect(sentence, starter.id).not.toMatch(/[[\]{}]/);
      const labels = choicesFor(starter.id).map((set) => set.choices[0]!.label);
      const plain = fillBlanks(starter.ask, labels);
      expect(stillFromStarter(plain, sentence), starter.id).toBe(true);
      // Every word the child picked is in it.
      for (const label of labels) expect(sentence).toContain(label);
      expect(unansweredBlanks(plan, answers)).toEqual([]);
    }
  });

  it("with every extra picked too, still has no holes and still reads as the card's", () => {
    for (const starter of withBlanks) {
      const plan = wordsPlanFor(starter.id)!;
      const answers: Record<string, ReadonlyArray<string>> = { ...firstBlanks(starter.id) };
      for (const step of plan.steps) {
        for (const group of step.groups) {
          if (group.kind === "extra") answers[group.slot] = [group.chips[0]!.label];
        }
      }
      const sentence = wordsSentence(plan, answers);
      expect(sentence, starter.id).not.toMatch(/[[\]{}]/);
      expect(sentence).not.toContain("  ");
      const labels = choicesFor(starter.id).map((set) => set.choices[0]!.label);
      expect(stillFromStarter(fillBlanks(starter.ask, labels), sentence), starter.id).toBe(true);
    }
  });

  it("builds the game sentence the way the design shows it", () => {
    const plan = wordsPlanFor("game")!;
    const sentence = wordsSentence(plan, {
      b0: ["catch the falling stars"],
      place: ["set in space"],
      controls: ["the arrow keys"],
      twist: ["it gets faster and faster"],
    });
    expect(sentence).toBe(
      "Please make a simple game I can play in the page: catch the falling stars, set in space. Use the arrow keys, keep score, and show a big “Play again” button at the end. Add a twist: it gets faster and faster.",
    );
    // Nothing optional picked: the card's own controls words stay.
    expect(wordsSentence(plan, { b0: ["a maze"] })).toBe(
      "Please make a simple game I can play in the page: a maze. Use the arrow keys or the mouse, keep score, and show a big “Play again” button at the end.",
    );
  });

  it("shows a placeholder for a blank nobody has filled yet, only in the live sentence", () => {
    const plan = wordsPlanFor("game")!;
    const live = wordsSegments(plan, {}, true);
    expect(live.map((segment) => segment.text).join("")).toContain("your game");
    expect(wordsSentence(plan, {})).not.toContain("your game");
    expect(unansweredBlanks(plan, {})).toEqual(["b0"]);
  });

  it("marks the child's words so the sentence can colour them", () => {
    const plan = wordsPlanFor("pet")!;
    const marked = wordsSegments(plan, { b0: ["cat"], b1: ["Luna"] }, true).filter(
      (segment) => segment.group !== undefined,
    );
    expect(marked).toEqual([
      { text: "cat", group: "b0" },
      { text: "Luna", group: "b1" },
    ]);
  });

  it("never writes 'for kids' or an age into a chip", () => {
    for (const plan of WORD_PLANS) {
      for (const step of plan.steps) {
        for (const group of step.groups) {
          if (group.kind !== "extra") continue;
          for (const chip of group.chips) expect(chip.label).not.toMatch(/\bkids?\b|\d/i);
        }
      }
    }
  });
});

describe("joinWords", () => {
  it("joins one, two and three", () => {
    expect(joinWords([])).toBe("");
    expect(joinWords(["a"])).toBe("a");
    expect(joinWords(["a", "b"])).toBe("a and b");
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
  });
});
