// nondev-seam: skycot-no-provider-update-prompt-test
import { describe, expect, it } from "vite-plus/test";

import { shouldShowProviderUpdatePrompt } from "./skycotProviderUpdatePrompt";

describe("shouldShowProviderUpdatePrompt", () => {
  it("is off for the SKYCOT brand and on for plain T3 Code", () => {
    expect(shouldShowProviderUpdatePrompt("SKYCOT")).toBe(false);
    expect(shouldShowProviderUpdatePrompt("skycot")).toBe(false);
    expect(shouldShowProviderUpdatePrompt("T3 Code")).toBe(true);
  });
});
