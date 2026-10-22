// Which look someone sees before they pick one. Workshop is SKYCOT's default (decided
// 22 Oct 2026); Classic is the calm alternative, one click away. Pure, so the rules are tested
// without a browser; store.ts does the reading and writing.
import { CLASSIC_THEME_ID } from "./library";

export const DEFAULT_THEME_ID = "workshop";

/**
 * This browser's fallback when no look was picked: "workshop", or "classic" for a browser that
 * ran SKYCOT before Workshop became the default. Until then picking Classic stored nothing, so
 * "nothing stored" there means "the Classic they have been looking at", and that stays put.
 */
export function settleBrowserDefault(input: {
  /** What an earlier visit settled (the browser-default key), if anything. */
  readonly settled: string | null;
  /** The stored choice (`skycot:theme`), if any. */
  readonly chosen: string | null;
  /** Whether this browser has run SKYCOT before (a saved first-paint colour, an onboarding answer). */
  readonly ranBefore: boolean;
}): string {
  if (input.settled === DEFAULT_THEME_ID || input.settled === CLASSIC_THEME_ID) {
    return input.settled;
  }
  return input.ranBefore && input.chosen === null ? CLASSIC_THEME_ID : DEFAULT_THEME_ID;
}

/** The look in force: the person's choice when there is one, else this browser's default. */
export function resolveActiveThemeId(chosen: string | null, browserDefault: string): string {
  return chosen ?? browserDefault;
}
