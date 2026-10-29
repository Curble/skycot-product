// Build help: how much help a child gets turning a starter card into a message for Sam.
// Pictures = tap a picture (the Little makers step picker), Words = tap word chips and watch the
// sentence grow, Builder = pick the parts, then edit the whole sentence. Pure decisions and
// names here, so they are tested (buildHelp.test.ts) and the sheets stay dumb. This is UI only:
// the assistant is never told a child's level, band or age.

import { BUILD_HELP_LEVELS, type BuildHelp, type ReadingLevel } from "../family/children";
import { hasPicker } from "./choices";
import { hasRecipe } from "./recipes";
import { hasWords } from "./wordChoices";

export { BUILD_HELP_LEVELS, type BuildHelp };

/** The level a child starts at until they (or a grown-up) choose: follows the age band. */
export function levelForBand(band: ReadingLevel | null | undefined): BuildHelp {
  if (band === "little-makers") return "pictures";
  if (band === "big-makers") return "builder";
  return "words";
}

export type BuildHelpScreen = "chooser" | BuildHelp;

/**
 * Which screen a tap on a kids' card opens. A child (or grown-up) who has chosen goes straight
 * into that level; before that the first tap is the "choose your path" screen, with the age
 * band's level marked as the good start.
 */
export function firstScreen(input: {
  readonly stored: BuildHelp | null | undefined;
  readonly band: ReadingLevel | null | undefined;
}): { readonly screen: BuildHelpScreen; readonly suggested: BuildHelp } {
  const suggested = levelForBand(input.band);
  return input.stored === null || input.stored === undefined
    ? { screen: "chooser", suggested }
    : { screen: input.stored, suggested };
}

export interface BuildHelpInfo {
  readonly level: BuildHelp;
  readonly name: string;
  /** One kid-friendly line on the chooser card. */
  readonly blurb: string;
  /** The grown-up's line in Settings: the name of the age band it matches, and what it does. */
  readonly grownUpLine: string;
}

export const BUILD_HELP_INFO: ReadonlyArray<BuildHelpInfo> = [
  {
    level: "pictures",
    name: "Pictures",
    blurb: "Tap a picture. Sam does the rest.",
    grownUpLine: "Little makers · one big question at a time, with picture tiles",
  },
  {
    level: "words",
    name: "Words",
    blurb: "Tap words and watch your idea grow.",
    grownUpLine: "Makers · tap word chips and watch the sentence grow",
  },
  {
    level: "builder",
    name: "Builder",
    blurb: "Choose the parts, then fix the words yourself.",
    grownUpLine: "Big makers · pick the parts, then edit the whole sentence",
  },
];

export function buildHelpInfo(level: BuildHelp): BuildHelpInfo {
  return BUILD_HELP_INFO.find((entry) => entry.level === level)!;
}

/** The family card's one line, for a grown-up: "Build help starts at Words" or the age band. */
export function buildHelpLine(
  stored: BuildHelp | null | undefined,
  band: ReadingLevel | null | undefined,
): string {
  return stored === null || stored === undefined
    ? `Build help follows the age band (${buildHelpInfo(levelForBand(band)).name})`
    : `Build help starts at ${buildHelpInfo(stored).name}`;
}

/** Whether a card gets build help: it has blanks, and all three levels cover every one. */
export function hasBuildHelp(starterId: string): boolean {
  return hasPicker(starterId) && hasWords(starterId) && hasRecipe(starterId);
}
