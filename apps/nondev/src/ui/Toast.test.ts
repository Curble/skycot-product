import { describe, expect, it } from "vite-plus/test";

import { toastPlace } from "./Toast";

const box = (top: number, height: number, left = 0, width = 390) => ({ top, height, left, width });

describe("toastPlace", () => {
  it("sits just above the message box (or the put-away banner in its place)", () => {
    // A phone: the message box starts 120px above the bottom of an 844px screen.
    expect(toastPlace(844, [box(724, 120)])).toEqual({ bottom: 132, center: 195 });
  });

  it("centres over the conversation's column on a Mac", () => {
    expect(toastPlace(848, [box(640, 208, 520, 920)])).toEqual({ bottom: 220, center: 980 });
  });

  it("clears the highest box when two are on screen", () => {
    expect(toastPlace(848, [box(760, 88), box(620, 228)])?.bottom).toBe(240);
  });

  it("leaves the stylesheet's place when no message box is showing", () => {
    expect(toastPlace(844, [])).toBeNull();
    expect(toastPlace(844, [box(0, 0)])).toBeNull();
    expect(toastPlace(844, [box(900, 80)])).toBeNull();
  });
});
