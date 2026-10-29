/**
 * Child mode on the phone is deferred, not deleted (decision 29 Oct 2026): version 1 of SKYCOT
 * on iPhone and iPad is a grown-up companion to the family's Mac. The build flag
 * SKYCOT_MOBILE_CHILD_MODE (app.config.ts, surfaced as `extra.childMode`) is OFF for store and
 * TestFlight builds. These are the pure rules; see docs/nondev/autopilot/briefs/2026-10-29-phone-grown-up-only.md.
 */
import type { DeviceMode } from "../links/pairing";

export const readChildModeFlag = (extra: unknown): boolean =>
  typeof extra === "object" &&
  extra !== null &&
  (extra as { childMode?: unknown }).childMode === true;

/** What the root screen shows for a linked device. */
export type RootChoice = "grown-up" | "child" | "child-note";

export const rootChoice = (
  mode: Exclude<DeviceMode, "unlinked">,
  childModeOn: boolean,
): RootChoice => (mode === "grown-up" ? "grown-up" : childModeOn ? "child" : "child-note");

/** Push tokens: grown-up devices always; a child's device only when child mode is built in. */
export const mayRegisterForPush = (mode: DeviceMode, childModeOn: boolean): boolean =>
  mode === "grown-up" || (mode === "child" && childModeOn);

export const childDeviceNote = (childName: string | null) => {
  const who = childName ?? "your child";
  return {
    title: "This phone is linked as " + (childName === null ? "a child's" : `${childName}'s`),
    body: `In this version SKYCOT on iPhone is for grown-ups. ${childName ?? "Your child"} keeps making things on the Mac.`,
    action: "Unlink",
    who,
  };
};
