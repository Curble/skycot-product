import { describe, expect, it } from "vite-plus/test";

import {
  CHILD_PICK_MEMORY_MS,
  canReuseCurrentChild,
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
