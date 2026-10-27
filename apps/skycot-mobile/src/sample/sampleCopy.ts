/** The sample family's words, in one place (plain words, no developer terms). */
import type { SampleWho } from "./fixtures";

export const SAMPLE_BANNER_TEXT =
  "Sample family — nothing here is real. Link your Mac to use SKYCOT.";
export const SAMPLE_CODE_HINT = "Any four-digit parent code works in the sample.";
export const SAMPLE_ABOUT_TITLE = "Sample family";
export const SAMPLE_ABOUT_TEXT =
  "You are looking at a sample family: Ava, Leo and Sam's grown-up are made up, and nothing here is real or sent anywhere. To use SKYCOT, link this device to your family's Mac.";

export const switchViewLabel = (to: SampleWho): string =>
  to === "child" ? "See Ava's view" : "See the grown-up's view";
