import { describe, expect, it } from "vite-plus/test";

import { pickerAfterIdle, PICKER_IDLE_MS } from "./idlePicker";

describe("the shared Mac child picker idle time", () => {
  it("waits 20 minutes after the last input", () => {
    expect(pickerAfterIdle(1_000, 1_000 + PICKER_IDLE_MS - 1)).toBe(false);
    expect(pickerAfterIdle(1_000, 1_000 + PICKER_IDLE_MS)).toBe(true);
  });
});
