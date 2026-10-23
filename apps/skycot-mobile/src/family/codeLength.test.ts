import { describe, expect, it } from "vite-plus/test";

import { codeComplete, codeLengthOf, sharedCodeLength } from "./codeLength";

describe("the parent code's length, for taking it on the last digit", () => {
  it("reads one Mac's length, and nothing when it did not say", () => {
    expect(codeLengthOf({ codeLength: 4 })).toBe(4);
    expect(codeLengthOf({ codeLength: null })).toBeNull();
    expect(codeLengthOf({})).toBeNull();
    expect(codeLengthOf(null)).toBeNull();
    expect(codeLengthOf({ codeLength: 9 })).toBeNull();
  });

  it("is known for several Macs only when they all agree", () => {
    expect(sharedCodeLength([])).toBeNull();
    expect(sharedCodeLength([{ codeLength: 6 }, { codeLength: 6 }])).toBe(6);
    expect(sharedCodeLength([{ codeLength: 6 }, { codeLength: 4 }])).toBeNull();
    expect(sharedCodeLength([{ codeLength: 6 }, null])).toBeNull();
  });

  it("is complete on the last digit only", () => {
    expect(codeComplete("482913", 6)).toBe(true);
    expect(codeComplete("48291", 6)).toBe(false);
    expect(codeComplete("4829", null)).toBe(false);
  });
});
