import { describe, expect, it } from "vite-plus/test";

import { draftFor, draftProblem, patchFor } from "./ChildEditorSheet";
import { childLabel, namesList, parseChild } from "./children";

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
