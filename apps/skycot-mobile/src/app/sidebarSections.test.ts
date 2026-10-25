// nondev-seam: skycot-ipad-sections-test
import { describe, expect, it } from "vitest";

import { CHILD_SIDEBAR_SECTIONS, grownupSidebarSections } from "./sidebarSections";
import { deriveLayout } from "../ui/layoutLogic";

describe("iPad sidebar destinations", () => {
  it("uses the compact and regular layout at the width breakpoints", () => {
    expect(deriveLayout({ width: 390, height: 844 }).variant).toBe("compact");
    expect(deriveLayout({ width: 820, height: 1180 }).variant).toBe("split");
  });

  it("keeps grown-up destinations out of the child's sidebar", () => {
    expect(CHILD_SIDEBAR_SECTIONS.map((section) => section.title)).toEqual([
      "Make",
      "My makes",
      "Fridge",
      "Stickers",
    ]);
    expect(CHILD_SIDEBAR_SECTIONS.map((section) => section.route)).not.toContain("Requests");
    expect(CHILD_SIDEBAR_SECTIONS.map((section) => section.route)).not.toContain("Children");
    expect(CHILD_SIDEBAR_SECTIONS.map((section) => section.route)).not.toContain("ThisDevice");
    expect(grownupSidebarSections(2)[0]?.badge).toBe("2");
  });
});
