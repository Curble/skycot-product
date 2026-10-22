import { describe, expect, it } from "vite-plus/test";

import { MASCOT_FULL_NAME, MASCOT_NAME, PRODUCT_NAME } from "../../brand";
import { MASCOT_POSE_DESCRIPTIONS, mascotAccessibleName, mascotCopy } from "./mascotCopy";

describe("mascot copy", () => {
  it("names the cloud after the product, and nothing else", () => {
    expect(MASCOT_NAME).toBe(PRODUCT_NAME);
    expect(MASCOT_FULL_NAME).toBe("SKYCOT the cloud");
    const everything = [...Object.values(mascotCopy), ...Object.values(MASCOT_POSE_DESCRIPTIONS)];
    for (const line of everything) expect(line).not.toMatch(/nimbo|helper/i);
  });

  it("speaks each pose as the character doing something", () => {
    expect(mascotAccessibleName("hello")).toBe("SKYCOT the cloud, waving");
    expect(mascotAccessibleName("oops")).toBe("SKYCOT the cloud, saying oops");
    expect(mascotAccessibleName("ask-a-grown-up")).toBe("SKYCOT the cloud, asking for a grown-up");
  });

  it("lets a call site describe the moment, and ignores a blank description", () => {
    expect(mascotAccessibleName("yay", "cheering you on")).toBe(
      "SKYCOT the cloud, cheering you on",
    );
    expect(mascotAccessibleName("thinking", "  ")).toBe("SKYCOT the cloud, thinking");
  });

  it("keeps the visible lines short and plain", () => {
    expect(mascotCopy.homeHello).toBe("SKYCOT says hello");
    expect(mascotCopy.introduction).toBe("Hi, I'm SKYCOT.");
    expect(mascotCopy.aboutLine).toBe("The cloud is SKYCOT too.");
  });
});
