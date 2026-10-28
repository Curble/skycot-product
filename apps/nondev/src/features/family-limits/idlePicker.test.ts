import { describe, expect, it } from "vite-plus/test";

import {
  CHILD_PICK_MEMORY_MS,
  canReuseCurrentChild,
  freshTabChildAction,
  bufferPickerCode,
  pickerAfterIdle,
  PICKER_IDLE_MS,
  rememberedChildIsFresh,
  shouldShowChildPicker,
} from "./idlePicker";

describe("the shared Mac child picker idle time", () => {
  it("keeps a quick code burst while the grown-up field opens", () => {
    expect(bufferPickerCode("123", "4")).toBe("1234");
    expect(bufferPickerCode("123", "Backspace")).toBe("12");
    expect(bufferPickerCode("123", "a")).toBeNull();
  });

  it("waits an hour after the last input", () => {
    expect(pickerAfterIdle(1_000, 1_000 + PICKER_IDLE_MS - 1)).toBe(false);
    expect(pickerAfterIdle(1_000, 1_000 + PICKER_IDLE_MS)).toBe(true);
  });

  it("remembers a child for eight hours", () => {
    expect(rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS - 1)).toBe(true);
    expect(rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS)).toBe(false);
    expect(rememberedChildIsFresh(1_000, 999)).toBe(false);
  });

  it("reuses a recent child in a fresh tab and asks again after the memory expires", () => {
    expect(
      canReuseCurrentChild({
        childCount: 2,
        currentChildId: "ava",
        rememberedChildId: rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS - 1)
          ? "ava"
          : null,
      }),
    ).toBe(true);
    expect(
      canReuseCurrentChild({
        childCount: 2,
        currentChildId: "ava",
        rememberedChildId: rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS)
          ? "ava"
          : null,
      }),
    ).toBe(false);
  });

  it("runs the eight-hour choice on first load: restore recent, pick after expiry", () => {
    const rememberedChildId = rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS - 1)
      ? "ava"
      : null;
    expect(
      freshTabChildAction({
        childCount: 2,
        currentChildId: "leo",
        needsChoice: false,
        rememberedChildId,
      }),
    ).toBe("restore");
    const expiredChildId = rememberedChildIsFresh(1_000, 1_000 + CHILD_PICK_MEMORY_MS)
      ? "ava"
      : null;
    expect(
      freshTabChildAction({
        childCount: 2,
        currentChildId: "ava",
        needsChoice: false,
        rememberedChildId: expiredChildId,
      }),
    ).toBe("pick");
  });

  it("never restores a child over a window a grown-up has just unlocked", () => {
    // The engine's session arrives a beat after the code; without this the picker came back over
    // grown-up mode and the code had to be typed twice (packaged beta 35).
    expect(
      freshTabChildAction({
        childCount: 2,
        currentChildId: null,
        needsChoice: true,
        rememberedChildId: null,
        grownUpMarked: true,
      }),
    ).toBe("grown-up");
    expect(
      freshTabChildAction({
        childCount: 2,
        currentChildId: null,
        needsChoice: true,
        rememberedChildId: null,
        grownUpMarked: false,
      }),
    ).toBe("pick");
  });

  it("keeps the picker for explicit switches and multi-child choices only", () => {
    const single = {
      shared: true,
      requested: false,
      childCount: 1,
      grownUpActive: false,
      needsChoice: true,
      picked: false,
    };
    expect(shouldShowChildPicker(single)).toBe(false);
    expect(shouldShowChildPicker({ ...single, requested: true })).toBe(true);
    expect(shouldShowChildPicker({ ...single, childCount: 2 })).toBe(true);
    expect(shouldShowChildPicker({ ...single, shared: false, requested: true })).toBe(false);
  });
});
