import { describe, expect, it } from "vite-plus/test";

import { AVATAR_CHARACTERS, CHARACTER_ART } from "./characters";
import { parseAvatar } from "./children";

describe("drawn characters", () => {
  it("has artwork for every character and reads a chosen one back", () => {
    expect(AVATAR_CHARACTERS).toHaveLength(16);
    for (const id of AVATAR_CHARACTERS) expect(CHARACTER_ART[id].body.length).toBeGreaterThan(20);
    expect(parseAvatar({ kind: "character", id: "dino" })).toEqual({
      kind: "character",
      id: "dino",
    });
    // Anything unknown falls back to a letter, never to raw input.
    expect(parseAvatar({ kind: "character", id: "<script>" }).kind).toBe("initial");
  });
});
