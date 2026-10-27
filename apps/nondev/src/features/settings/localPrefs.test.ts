// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { familyFeaturePreferences, writeFamilyCertificatesOn } from "./localPrefs";

describe("grown-up choices for family extras", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps certificates on by default and lets a parent turn them off and back on", () => {
    expect(familyFeaturePreferences.certificatesOn()).toBe(true);

    writeFamilyCertificatesOn(false);
    expect(familyFeaturePreferences.certificatesOn()).toBe(false);

    writeFamilyCertificatesOn(true);
    expect(familyFeaturePreferences.certificatesOn()).toBe(true);
  });
});
