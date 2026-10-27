import { describe, expect, it } from "vite-plus/test";

import { readingBandLine } from "./readingBandLine";

describe("readingBandLine", () => {
  it("names the band in plain words", () => {
    expect(readingBandLine("little-makers")).toBe("Sam explains for Little makers (5–7)");
    expect(readingBandLine("big-makers")).toBe("Sam explains for Big makers (11+)");
  });
  it("shows nothing when the level is missing", () => {
    expect(readingBandLine(undefined)).toBeNull();
    expect(readingBandLine(null)).toBeNull();
  });
});
