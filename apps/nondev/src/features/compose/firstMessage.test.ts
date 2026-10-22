import { describe, expect, it } from "vite-plus/test";

import { firstMessageLabels, titleSeedFrom } from "./firstMessage";

const SHOWPIECE = "my name is Ava Smith and I go to St Kilda Primary";

describe("firstMessageLabels", () => {
  it("never puts a full name or a school in the title or the branch in the Family profile", () => {
    const labels = firstMessageLabels(SHOWPIECE, "abcd1234", true);
    expect(labels.title).toBe("my name is Ava and I go to school");
    expect(labels.title).not.toContain("Smith");
    expect(labels.branch).not.toContain("smith");
    expect(labels.branch).not.toContain("kilda");
  });

  it("leaves an adult's words alone outside the profile", () => {
    expect(firstMessageLabels(SHOWPIECE, "abcd", false).title).toBe(SHOWPIECE);
  });

  it("titles from the first line, trimmed to 80 characters", () => {
    expect(titleSeedFrom("\n  Make a space game  \nwith stars")).toBe("Make a space game");
    expect(titleSeedFrom("x".repeat(100))).toHaveLength(80);
  });
});
