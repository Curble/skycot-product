import { describe, expect, it } from "vite-plus/test";

import { conversationSearchVisible } from "./searchVisibility";

describe("conversation search visibility", () => {
  it("keeps search out of the child view while leaving it available to grown-ups", () => {
    expect(conversationSearchVisible(true)).toBe(false);
    expect(conversationSearchVisible(false)).toBe(true);
  });
});
