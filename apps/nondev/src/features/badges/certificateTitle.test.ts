import { describe, expect, it } from "vite-plus/test";

import { certificateTitle } from "./certificateTitle";

describe("the certificate's make title", () => {
  it("keeps the first name but removes other personal details the shield recognizes", () => {
    expect(certificateTitle("Ava Smith's birthday game")).toBe("Ava's birthday game");
  });

  it("cleans whitespace and leaves an empty title blank", () => {
    expect(certificateTitle("  My   Cat  ")).toBe("My Cat");
    expect(certificateTitle("   ")).toBeNull();
  });
});
