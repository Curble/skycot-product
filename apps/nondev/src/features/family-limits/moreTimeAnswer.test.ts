import { describe, expect, it } from "vite-plus/test";

import { askedWho, moreTimeAnswerFor, moreTimeAnswerLine } from "./moreTimeAnswer";

describe("more-time answer for the child", () => {
  it("names who was asked", () => {
    expect(askedWho([])).toBe("a grown-up");
    expect(askedWho([null, " "])).toBe("a grown-up");
    expect(askedWho(["Sarah Example"])).toBe("Sarah");
    expect(askedWho(["Mum", null, "Dad"])).toBe("Mum or Dad");
  });

  it("reads the answer on the child's own note only", () => {
    const notes = [
      { id: "n1", kind: "more-time" },
      { id: "n2", kind: "more-time", answer: { minutes: 15, by: "Mum" } },
      { id: "n3", kind: "shown", answer: { minutes: 15, by: "Mum" } },
      { id: "n4", kind: "more-time", answer: { minutes: 45, by: "Mum" } },
    ];
    expect(moreTimeAnswerFor(notes, "n1")).toBeNull();
    expect(moreTimeAnswerFor(notes, "n2")).toEqual({ minutes: 15, by: "Mum" });
    expect(moreTimeAnswerFor(notes, "n3")).toBeNull();
    expect(moreTimeAnswerFor(notes, "n4")).toBeNull();
  });

  it("says the answer kindly", () => {
    expect(moreTimeAnswerLine({ minutes: 30, by: "Dad" })).toBe("Dad gave you 30 more minutes!");
    expect(moreTimeAnswerLine({ minutes: 0, by: "Mum" })).toBe(
      "Mum said not tonight. Your work is saved for next time.",
    );
  });
});
