import { describe, expect, it } from "vite-plus/test";

import {
  biometryWords,
  childMayStartInProject,
  childSeesProject,
  childSeesThread,
  cleanName,
  deviceIdFromSubject,
  deviceKeyRegisterAction,
  deviceKeySignedMessage,
  deviceSubject,
  groupLinkCode,
  isApproverDecision,
  isDeviceKeyBiometry,
  isWatchKeyProtection,
  normaliseLinkCode,
  watchRegisterAction,
  watchSignedMessage,
} from "./people.ts";

const owners = {
  threads: { "thread-ava": "ava", "thread-leo": "leo" },
  projects: { "project-ava": "ava", "project-leo": "leo" },
};

describe("who is who", () => {
  it("reads a device only from the subject the engine gave its sign-in", () => {
    expect(deviceIdFromSubject(deviceSubject("d0a1b2c3d4e"))).toBe("d0a1b2c3d4e");
    expect(deviceIdFromSubject("one-time-token")).toBeNull();
    expect(deviceIdFromSubject("skycot-family-device:../../etc")).toBeNull();
    expect(deviceIdFromSubject("skycot-family-device:")).toBeNull();
    expect(deviceIdFromSubject(undefined)).toBeNull();
  });

  it("a child's device sees only that child's conversations", () => {
    expect(childSeesThread("ava", "thread-ava", owners)).toBe(true);
    expect(childSeesThread("ava", "thread-leo", owners)).toBe(false);
    // Nobody recorded starting it (older work, a grown-up's): not on a child's device.
    expect(childSeesThread("ava", "thread-old", owners)).toBe(false);
  });

  it("a child sees their own and the family's projects, not a sibling's", () => {
    expect(childSeesProject("ava", "project-ava", owners)).toBe(true);
    expect(childSeesProject("ava", "project-family", owners)).toBe(true);
    expect(childSeesProject("ava", "project-leo", owners)).toBe(false);
    // Unless the child has a conversation of their own in it.
    expect(childSeesProject("ava", "project-leo", owners, new Set(["project-leo"]))).toBe(true);
  });

  it("a child starts new work only in their own or an unowned project, even with a thread in a sibling's", () => {
    expect(childMayStartInProject("ava", "project-ava", owners)).toBe(true);
    expect(childMayStartInProject("ava", "project-family", owners)).toBe(true);
    expect(childMayStartInProject("ava", "project-leo", owners)).toBe(false);
    // Seeing it through their own thread does not let them start there.
    expect(childSeesProject("ava", "project-leo", owners, new Set(["project-leo"]))).toBe(true);
  });

  it("start rights: own, unowned and unknown projects open; a sibling's and another child's shut", () => {
    const table: ReadonlyArray<readonly [string, string, boolean]> = [
      ["ava", "project-ava", true],
      ["leo", "project-ava", false],
      ["ava", "project-leo", false],
      ["leo", "project-leo", true],
      ["ava", "project-family", true],
      ["ava", "project-never-heard-of", true],
    ];
    for (const [child, project, expected] of table) {
      expect(childMayStartInProject(child, project, owners), `${child} in ${project}`).toBe(
        expected,
      );
    }
    // No owner records at all: nothing is anyone's, so every project is open.
    expect(childMayStartInProject("ava", "project-leo", { threads: {}, projects: {} })).toBe(true);
  });

  it("a grown-up's device may only accept or decline", () => {
    expect(isApproverDecision("accept")).toBe(true);
    expect(isApproverDecision("decline")).toBe(true);
    expect(isApproverDecision("acceptForSession")).toBe(false);
    expect(isApproverDecision("acceptAlways")).toBe(false);
    expect(isApproverDecision("cancel")).toBe(false);
  });

  it("forgives how people type a link code, and groups it for reading", () => {
    expect(normaliseLinkCode(" 7kq3-m9xd 2hpa ")).toBe("7KQ3M9XD2HPA");
    expect(groupLinkCode("7KQ3M9XD2HPA")).toBe("7KQ3 M9XD 2HPA");
    expect(cleanName("  Mum's   phone ", 40)).toBe("Mum's phone");
    expect(cleanName("   ", 40)).toBeNull();
    expect(cleanName(42, 40)).toBeNull();
  });

  it("names exactly what a Watch signs, line by line", () => {
    expect(watchSignedMessage("approve", "abc", "approve:t1:r1:f1")).toBe(
      "SKYCOT Watch v1\napprove\nabc\napprove:t1:r1:f1",
    );
    expect(watchRegisterAction("d0a1b2c3")).toBe("watch-register:d0a1b2c3");
    expect(isWatchKeyProtection("secure-enclave")).toBe(true);
    expect(isWatchKeyProtection("trust-me")).toBe(false);
  });

  it("names what the phone's Face ID key signs, with its own first line", () => {
    expect(deviceKeySignedMessage("approve", "abc", "approve:t1:r1:f1")).toBe(
      "SKYCOT Device Key v1\napprove\nabc\napprove:t1:r1:f1",
    );
    // Never the Watch's message, so one key's signature can't stand in for the other's.
    expect(deviceKeySignedMessage("approve", "abc", "x")).not.toBe(
      watchSignedMessage("approve", "abc", "x"),
    );
    expect(deviceKeyRegisterAction("d0a1b2c3")).toBe("device-key-register:d0a1b2c3");
    expect(isDeviceKeyBiometry("face-id")).toBe(true);
    expect(isDeviceKeyBiometry("passcode")).toBe(false);
    expect(biometryWords("face-id")).toBe("Face ID");
    expect(biometryWords("touch-id")).toBe("Touch ID");
  });
});
