// nondev-seam: skycot-iphone-q39-destination-picker-test
import { describe, expect, it } from "vite-plus/test";

import { shouldShowDestinationPicker, shouldStartFreshPage } from "./destinationPicker";

describe("the child's destination picker", () => {
  it("hides a single child's project and shows a choice between child projects", () => {
    expect(shouldShowDestinationPicker(0, 1)).toBe(false);
    expect(shouldShowDestinationPicker(1, 1)).toBe(false);
    expect(shouldShowDestinationPicker(2, 1)).toBe(true);
    expect(shouldShowDestinationPicker(2, 0)).toBe(true);
    expect(shouldShowDestinationPicker(1, 2)).toBe(true);
  });

  it("starts a fresh page by default, unless the child chooses to change a project", () => {
    expect(shouldStartFreshPage(true, true)).toBe(true);
    expect(shouldStartFreshPage(true, false)).toBe(false);
    expect(shouldStartFreshPage(false, true)).toBe(true);
  });
});
