import { describe, expect, it } from "vite-plus/test";

import { shownAgainLater, splitInlineSteps, unwrapProposedPlanTags } from "./planText";

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

describe("unwrapProposedPlanTags", () => {
  const steps = "1. Add a big green button.\n2. Make it say hi.";

  it("shows the steps without the tags", () => {
    expect(unwrapProposedPlanTags(`<proposed_plan>\n${steps}\n</proposed_plan>`)).toBe(steps);
  });

  it("keeps the words before and after the block", () => {
    expect(
      unwrapProposedPlanTags(`Here you go.\n<proposed_plan>\n${steps}\n</proposed_plan>\nOK?`),
    ).toBe(`Here you go.\n\n${steps}\n\nOK?`);
  });

  it("handles tags that were escaped on the way", () => {
    expect(unwrapProposedPlanTags(`&lt;proposed_plan&gt;\n${steps}\n&lt;/proposed_plan&gt;`)).toBe(
      steps,
    );
  });

  it("leaves ordinary text alone", () => {
    expect(unwrapProposedPlanTags("Just a normal reply.")).toBe("Just a normal reply.");
  });
});
