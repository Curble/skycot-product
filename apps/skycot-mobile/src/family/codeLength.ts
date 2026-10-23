/**
 * How many digits the parent code has, as the Macs said (never the code itself). A Mac tells
 * only the family's Mac and grown-ups' devices, so a child's device always gets null here and
 * its code boxes wait for their button. With it, the code box tries the code on its last digit,
 * like the iPhone's lock screen.
 */
import {
  codeComplete,
  parseCodeLength,
  type ServerFamilyStatus,
} from "../../../nondev/src/features/family/family";

export { codeComplete };

/** One Mac's length, or null when it did not say (an older Mac, a child's device). */
export function codeLengthOf(
  status: Pick<ServerFamilyStatus, "codeLength"> | null | undefined,
): number | null {
  return parseCodeLength(status?.codeLength);
}

/**
 * The length when one code goes to several Macs at once (the Watch's set-up): known only when
 * every one of them says the same length, else null (the button).
 */
export function sharedCodeLength(
  statuses: ReadonlyArray<Pick<ServerFamilyStatus, "codeLength"> | null | undefined>,
): number | null {
  const lengths = statuses.map(codeLengthOf);
  const first = lengths[0];
  if (first === undefined || first === null) return null;
  return lengths.every((length) => length === first) ? first : null;
}
