// nondev-seam: skycot-plan-grownup-note
import { describe, expect, it } from "vite-plus/test";

import { planMayNeedGrownUp } from "./planNeedsGrownUp";

describe("planMayNeedGrownUp", () => {
  it.each([
    "1. Install Lodash from npm",
    "1. Install Lodash from the add-on library.",
    "1. Download a sound from the internet",
    "1. Fetch https://example.com",
    "1. Use a library from the internet",
    "1) Run pip install pillow",
    "2. Works without internet, but install confetti from npm",
  ])("is true for %s", (step) => {
    expect(planMayNeedGrownUp(step)).toBe(true);
  });

  it.each([
    "1. Make a birthday card page with balloons",
    "1. Add a title and a big button",
    "1. Check the page works",
    "1. Draw an installation art poster",
    "2. Make the confetti button work without internet",
    "2. Keep it all in one page, no downloads needed",
    "3. It doesn't need any add-ons",
  ])("is false for %s", (step) => {
    expect(planMayNeedGrownUp(step)).toBe(false);
  });

  it("reads only numbered steps, not prose around them", () => {
    const plan = "I could install a package, but I will not.\n\n1. Add a title\n2. Add a button";
    expect(planMayNeedGrownUp(plan)).toBe(false);
    expect(planMayNeedGrownUp(`${plan}\n3. Install confetti from npm`)).toBe(true);
  });
});
