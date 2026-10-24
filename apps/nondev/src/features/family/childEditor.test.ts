import { describe, expect, it } from "vite-plus/test";

import {
  askEachStepHelp,
  askEachStepTitle,
  draftFor,
  draftProblem,
  patchFor,
} from "./ChildEditorSheet";
import { askedEachStepLine, childLabel, namesList, parseChild } from "./children";

describe("the child editor", () => {
  it("starts a new child with voice typing off, read-aloud on and the next colour", () => {
    const draft = draftFor(null, 1);
    expect(draft.voiceTyping).toBe(false);
    expect(draft.readAloud).toBe(true);
    expect(draft.avatar).toEqual({ kind: "initial", color: "sun" });
    expect(draft.bedtimeOn).toBe(false);
  });

  it("saves exactly what the sheet shows", () => {
    const draft = {
      ...draftFor(null, 0),
      name: "  Leo ",
      bedtimeOn: true,
      bedtimeStart: "19:00",
      bedtimeEnd: "06:30",
      dailyTurns: 20,
    };
    expect(patchFor(draft)).toMatchObject({
      name: "Leo",
      voice: { typing: false, readAloud: true },
      limits: { bedtime: { start: "19:00", end: "06:30" }, dailyMinutes: null, dailyTurns: 20 },
    });
    expect(patchFor({ ...draft, name: "  " }).name).toBeNull();
  });

  it("refuses a bedtime that starts when it ends", () => {
    const draft = {
      ...draftFor(null, 0),
      bedtimeOn: true,
      bedtimeStart: "07:00",
      bedtimeEnd: "07:00",
    };
    expect(draftProblem(draft)).toMatch(/different times/);
    expect(draftProblem({ ...draft, bedtimeOn: false })).toBeNull();
  });
});

describe("Ask before each step", () => {
  it("starts off for a new child and for a child from an older engine", () => {
    expect(draftFor(null, 0).askEachStep).toBe(false);
    expect(parseChild({ id: "a", name: "Ava" })?.askEachStep).toBe(false);
    expect(parseChild({ id: "a", name: "Ava", askEachStep: "yes" })?.askEachStep).toBe(false);
  });

  it("reads the engine's setting and saves exactly what the switch shows", () => {
    const child = parseChild({ id: "a", name: "Ava", askEachStep: true })!;
    expect(child.askEachStep).toBe(true);
    expect(draftFor(child, 0).askEachStep).toBe(true);
    expect(patchFor({ ...draftFor(child, 0), askEachStep: false }).askEachStep).toBe(false);
    expect(patchFor(draftFor(child, 0)).askEachStep).toBe(true);
  });

  it("tells Settings who is asked before each step", () => {
    expect(askedEachStepLine([{ name: "Ava", askEachStep: false }])).toMatch(/their settings/);
    expect(
      askedEachStepLine([
        { name: "Ava", askEachStep: true },
        { name: null, askEachStep: true },
      ]),
    ).toBe("Ava and Child 2 are asked before each step, as you chose.");
  });

  it("names the child and says what each position does", () => {
    expect(askEachStepTitle(" Ava ")).toBe("Ask Ava before each step");
    expect(askEachStepTitle("")).toBe("Ask them before each step");
    expect(askEachStepHelp(false, "Ava")).toMatch(/run by themselves/);
    expect(askEachStepHelp(false, "Ava")).toMatch(/still waits for a grown-up/);
    expect(askEachStepHelp(true, "Ava")).toMatch(/Ava is asked before every step/);
  });
});

describe("children", () => {
  it("reads an older engine's child without voice settings as voice typing off", () => {
    expect(parseChild({ id: "a", name: "Ava" })?.voice).toEqual({ typing: false, readAloud: true });
    expect(parseChild({ name: "no id" })).toBeNull();
  });

  it("names children without a name, and lists names", () => {
    expect(childLabel({ name: null }, 0)).toBe("Your child");
    expect(childLabel({ name: null }, 2)).toBe("Child 3");
    expect(namesList(["Ava", "Leo", "Mia"])).toBe("Ava, Leo and Mia");
  });
});
