import { describe, expect, it } from "vite-plus/test";

import { childModeBuilt } from "../../app.config";
import { childDeviceNote, mayRegisterForPush, readChildModeFlag, rootChoice } from "./childMode";

describe("child mode build flag", () => {
  it("is off for production unless asked, on for development by default", () => {
    expect(childModeBuilt({}, "production")).toBe(false);
    expect(childModeBuilt({ SKYCOT_MOBILE_CHILD_MODE: "" }, "production")).toBe(false);
    expect(childModeBuilt({ SKYCOT_MOBILE_CHILD_MODE: "1" }, "production")).toBe(true);
    expect(childModeBuilt({}, "development")).toBe(true);
    expect(childModeBuilt({ SKYCOT_MOBILE_CHILD_MODE: "0" }, "development")).toBe(false);
  });
  it("reads the flag from the app's extra, off when missing", () => {
    expect(readChildModeFlag(undefined)).toBe(false);
    expect(readChildModeFlag({ childMode: false })).toBe(false);
    expect(readChildModeFlag({ childMode: true })).toBe(true);
  });
});

describe("what a linked device shows", () => {
  it("shows the note, not child screens, on a child's device with the flag off", () => {
    expect(rootChoice("child", false)).toBe("child-note");
    expect(rootChoice("child", true)).toBe("child");
    expect(rootChoice("grown-up", false)).toBe("grown-up");
  });
  it("registers for push only on grown-up devices when the flag is off", () => {
    expect(mayRegisterForPush("grown-up", false)).toBe(true);
    expect(mayRegisterForPush("child", false)).toBe(false);
    expect(mayRegisterForPush("child", true)).toBe(true);
    expect(mayRegisterForPush("unlinked", true)).toBe(false);
  });
  it("words the note kindly", () => {
    const note = childDeviceNote("Ava");
    expect(note.title).toBe("This phone is linked as Ava's");
    expect(note.body).toBe(
      "In this version SKYCOT on iPhone is for grown-ups. Ava keeps making things on the Mac.",
    );
    expect(childDeviceNote(null).body).toContain("Your child keeps making things on the Mac.");
  });
});
