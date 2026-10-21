import { describe, expect, it } from "vite-plus/test";

import { titleFromPrompt } from "./NewAutomationSheet";

describe("titleFromPrompt", () => {
  it("uses a short first line as it is, without trailing punctuation", () => {
    expect(titleFromPrompt("Summarise this week's bookings.")).toBe(
      "Summarise this week's bookings",
    );
    expect(titleFromPrompt("")).toBe("Automation");
  });

  it("cuts a long first line at a word boundary with an ellipsis", () => {
    const title = titleFromPrompt(
      "QA4 verification automation. Safe to delete: summarise nothing and report back quietly",
    );
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toMatch(/nothi…$/);
    expect(title).toBe("QA4 verification automation. Safe to delete: summarise…");
  });
});
