// nondev-seam: skycot-iphone-q39-recap-copy-test
import { describe, expect, it } from "vite-plus/test";

import type { RecapMade } from "../../../../nondev/src/features/recap/recap";
import {
  compactMinutes,
  mobileGrownUpLines,
  mobileMadeSummary,
  mobileSwitchSummary,
} from "./recapCopy";

describe("plain recap words on a phone", () => {
  it("counts changed things without exposing file or line totals", () => {
    const made = {
      changes: [
        { files: [{ path: "page.html" }, { path: "style.css" }] },
        { files: [{ path: "page.html" }, { path: "notes.txt" }] },
      ],
    } as RecapMade;
    expect(mobileMadeSummary(made, "Ava")).toBe("Ava changed 3 things.");
    expect(mobileMadeSummary({ changes: [] } as RecapMade, "Ava")).toBeNull();
  });

  it("keeps time short enough for the small stat tile", () => {
    expect(compactMinutes(248)).toBe("4 h 8 m");
    expect(compactMinutes(60)).toBe("1 h");
    expect(compactMinutes(8)).toBe("8 m");
  });

  it("counts only the child's own files and hides package names", () => {
    const made = {
      changes: [{ files: [{ path: "page.html" }, { path: "node_modules/lodash/index.js" }] }],
    } as RecapMade;
    expect(mobileMadeSummary(made, "Ava")).toBe("Ava changed 1 thing.");
    expect(mobileGrownUpLines(["SKYCOT added lodash and cannon-es for Ava."])).toEqual([
      "SKYCOT added add-ons.",
    ]);
    expect(mobileSwitchSummary(1)).toBe("Sam used a different helper for a bit.");
    expect(mobileSwitchSummary(0)).toBeNull();
  });
});
