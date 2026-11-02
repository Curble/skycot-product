import { describe, expect, it } from "vite-plus/test";

import { shownAgainLater, splitInlineSteps } from "./planText";

describe("splitInlineSteps", () => {
  it("puts steps squeezed onto one line on their own lines", () => {
    expect(
      splitInlineSteps(
        "1. Add “Hello Ava” in big blue letters; 2. Use a white background; 3. Check it, then say “open it”.",
      ),
    ).toBe(
      "1. Add “Hello Ava” in big blue letters\n2. Use a white background\n3. Check it, then say “open it”.",
    );
  });

  it("leaves normal plans and stray numbers alone", () => {
    const plan = "1. Make a page.\n2. Use 3. columns? No, 2 columns.\n3. Check it.";
    expect(splitInlineSteps(plan)).toBe(plan);
    expect(splitInlineSteps("Pick 2. colours")).toBe("Pick 2. colours");
  });
});

describe("shownAgainLater", () => {
  const plan = "1. Make a tiny page.\n2. Use white.\n3. Check it.";

  it("is true when the next plan says the same thing", () => {
    expect(
      shownAgainLater({ ordinal: 1, markdown: plan }, [
        { type: "proposed_plan", ordinal: 1, markdown: plan },
        { type: "assistant_message", ordinal: 2 },
        { type: "proposed_plan", ordinal: 3, markdown: `${plan}\n` },
      ]),
    ).toBe(true);
  });

  it("is false when the next plan changed, even if a later one matches", () => {
    expect(
      shownAgainLater({ ordinal: 1, markdown: plan }, [
        { type: "proposed_plan", ordinal: 5, markdown: plan },
        { type: "proposed_plan", ordinal: 3, markdown: "1. Make it purple." },
      ]),
    ).toBe(false);
  });

  it("is false with no later plan", () => {
    expect(
      shownAgainLater({ ordinal: 1, markdown: plan }, [
        { type: "proposed_plan", ordinal: 1, markdown: plan },
      ]),
    ).toBe(false);
  });
});
