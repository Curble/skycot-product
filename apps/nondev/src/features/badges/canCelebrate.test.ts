import { describe, expect, it } from "vite-plus/test";

import { isFirstStickerArrival } from "./canCelebrate";

describe("sticker arrival", () => {
  it("keeps the full celebration for the first sticker only", () => {
    expect(isFirstStickerArrival(["first-creation", "animal-friend"], false)).toBe(true);
    expect(isFirstStickerArrival(["animal-friend"], false)).toBe(false);
    expect(isFirstStickerArrival(["first-creation"], true)).toBe(false);
  });
});
