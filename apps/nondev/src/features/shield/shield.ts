// The personal-details shield, the client's half: what to say before a Family message is
// sent. The detector is the engine's own (`@t3tools/skycot-rules/personal`), so what the card
// catches is what the engine would hide anyway; the card lets the child fix it first.
import {
  describePersonalCategories,
  findPersonalDetails,
  personalCategories,
  replacePersonalDetails,
  type PersonalCategory,
  type PersonalDetail,
} from "@t3tools/skycot-rules/personal";

export const shieldCopy = {
  title: "That looks like something private — let's use a nickname instead",
  photoTitle: "Pictures of faces stay private",
  photoQuestion:
    "Is there a person's face in this picture? Faces stay private, so pictures of things — drawings, pets, toys, places — are the ones to send.",
  whyPrivate:
    "Things like your full name, school or address stay with you. The assistant doesn't need them to help.",
  sendNicknames: "Send with nicknames",
  editMyself: "Change it myself",
  askGrownUp: "Ask a grown-up",
  noFaces: "No faces — send it",
  removePictures: "Take the pictures out",
  /** Shown where a short reply (a question's answer) carried a private detail. */
  inlineProblem: (found: string) =>
    `That looks like ${found}. Try a nickname instead — your full name, school and address stay private.`,
} as const;

export interface ShieldFinding {
  readonly text: string;
  readonly details: ReadonlyArray<PersonalDetail>;
  /** What was found, "photo" included when pictures go with the message. */
  readonly categories: ReadonlyArray<PersonalCategory>;
  /** The one-tap rewrite; null when only the pictures need a look. */
  readonly rewrite: string | null;
  readonly hasPictures: boolean;
  /** "It shares a full name and a school's name." — for the parent-code sheet. */
  readonly reason: string;
}

/** What the card should ask about, or null when the message can go as it is. */
export function shieldFinding(text: string, pictureCount = 0): ShieldFinding | null {
  const details = findPersonalDetails(text);
  const hasPictures = pictureCount > 0;
  if (details.length === 0 && !hasPictures) return null;
  const categories: Array<PersonalCategory> = [
    ...personalCategories(details),
    ...(hasPictures ? (["photo"] as const) : []),
  ];
  return {
    text,
    details,
    categories,
    rewrite: details.length > 0 ? replacePersonalDetails(text, details) : null,
    hasPictures,
    reason: `It shares ${describePersonalCategories(categories)}.`,
  };
}

/** "That looks like a full name and a school's name." */
export function shieldSentence(finding: Pick<ShieldFinding, "categories">): string {
  return `That looks like ${describePersonalCategories(finding.categories)}.`;
}

/** The calm problem line for a short reply that carried a private detail, else null. */
export function shieldProblem(text: string): string | null {
  const details = findPersonalDetails(text);
  if (details.length === 0) return null;
  return shieldCopy.inlineProblem(describePersonalCategories(personalCategories(details)));
}

export interface Segment {
  /** Where the part starts in the original message (a stable key). */
  readonly start: number;
  readonly text: string;
  /** Set on the parts the shield caught. */
  readonly detail?: PersonalDetail;
}

/** The message cut into plain parts and caught parts, for highlighting. */
export function segmentsOf(text: string, details: ReadonlyArray<PersonalDetail>): Array<Segment> {
  const segments: Array<Segment> = [];
  let cursor = 0;
  for (const detail of [...details].sort((a, b) => a.start - b.start)) {
    if (detail.start > cursor) {
      segments.push({ start: cursor, text: text.slice(cursor, detail.start) });
    }
    segments.push({ start: detail.start, text: text.slice(detail.start, detail.end), detail });
    cursor = detail.end;
  }
  if (cursor < text.length) segments.push({ start: cursor, text: text.slice(cursor) });
  return segments;
}

/** The rewrite cut the same way, with each stand-in marked, for the "try this" line. */
export function rewriteSegments(
  text: string,
  details: ReadonlyArray<PersonalDetail>,
): Array<Segment> {
  return segmentsOf(text, details).map((segment) =>
    segment.detail === undefined ? segment : { ...segment, text: segment.detail.suggestion },
  );
}
