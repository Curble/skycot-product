// nondev-seam: skycot-iphone-q39-home-accessibility-test
import { describe, expect, it } from "vite-plus/test";

import { accessibleMascotSize } from "./homeAccessibility";

describe("the Make greeting at large text sizes", () => {
  it("keeps the cloud visible and scales it with the system text size", () => {
    expect(accessibleMascotSize(1)).toBe(72);
    expect(accessibleMascotSize(1.5)).toBe(108);
    expect(accessibleMascotSize(3)).toBe(112);
    expect(accessibleMascotSize(3, true)).toBe(72);
  });
});
