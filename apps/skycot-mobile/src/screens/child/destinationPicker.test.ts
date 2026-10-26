// nondev-seam: skycot-iphone-q39-destination-picker-test
import { describe, expect, it } from "vite-plus/test";

import { shouldShowDestinationPicker } from "./destinationPicker";

describe("the child's destination picker", () => {
  it("stays hidden for one place and appears when there is a real choice", () => {
    expect(shouldShowDestinationPicker(0, 1)).toBe(false);
    expect(shouldShowDestinationPicker(1, 1)).toBe(true);
    expect(shouldShowDestinationPicker(2, 0)).toBe(true);
  });
});
