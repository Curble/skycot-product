import { describe, expect, it } from "vite-plus/test";

import { asksForReply } from "./status";

describe("asksForReply", () => {
  it("spots a question asked as a plain message", () => {
    expect(asksForReply("Which two dishes should go in the specials box?")).toBe(true);
    expect(
      asksForReply("I read all three pages.\n\nWhich two dishes should go in the specials box?"),
    ).toBe(true);
  });

  it("spots a request for an answer without a question mark", () => {
    expect(asksForReply("Please allow workspace access so I can add the section.")).toBe(true);
    expect(asksForReply("Let me know which colour you'd prefer and I'll carry on.")).toBe(true);
  });

  it("stays quiet for a finished report", () => {
    expect(asksForReply("Done. The footer now shows bookings@littleferncafe.com.au.")).toBe(false);
    expect(asksForReply("- added the page\n- linked it from the nav")).toBe(false);
    expect(asksForReply("")).toBe(false);
  });

  it("ignores questions buried in code blocks or early in a long reply", () => {
    expect(asksForReply("```\nwhat?\n```\nAll three pages open fine.")).toBe(false);
    expect(
      asksForReply(
        "Is this right? I checked. Then I fixed it. Then I tested it. All good now. Everything works.",
      ),
    ).toBe(false);
  });
});
