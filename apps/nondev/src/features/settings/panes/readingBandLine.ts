import type { ReadingLevel } from "../../family/children";
import { READING_BANDS } from "../../onboarding/onboarding";

/** The one line on a family card saying how Sam explains things for this child; null if unknown. */
export function readingBandLine(level: ReadingLevel | null | undefined): string | null {
  const band = READING_BANDS.find((entry) => entry.value === level);
  return band ? `Sam explains for ${band.label}` : null;
}
