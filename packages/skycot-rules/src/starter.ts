// nondev-seam: skycot-rules-package
// Starter cards' technical rules, sent as a hidden marker. A kids' starter card fills the
// message box with a friendly sentence only; the developer-sounding rules ("one new file
// called my-game.html, HTML, CSS and JavaScript all inside, works offline") travel as a marker
// line at the end of the message, the same way explain mode's choice does (see ./explain.ts):
// the plain client hides it, and the engine turns it into instructions for the assistant.
//
// The marker names the card, not the rules, so the rules live in one place (here) and a
// message can never carry rules of its own: an id that is not a card means no rules.

/** The one page each kids' card asks for, so "Open it" has one thing to open. */
export const STARTER_FILE_NAMES: Readonly<Record<string, string>> = {
  game: "my-game.html",
  pet: "my-pet.html",
  birthday: "birthday-card.html",
  school: "my-project.html",
  comic: "my-comic.html",
  quiz: "my-quiz.html",
  draw: "my-drawing.html",
  surprise: "surprise.html",
};

const ID = "[a-z][a-z0-9-]{0,31}";
const EXPLAIN_MARKER_TEXT = "\\[SKYCOT: (?:explain how you did it|no explanation needed)\\]";
/** The marker at the end, optionally followed by explain mode's own marker. */
const STARTER_AT_END = new RegExp(
  `\\s*\\[SKYCOT: starter (${ID})\\](?:\\s*${EXPLAIN_MARKER_TEXT})?\\s*$`,
);
/** The starter marker alone at the end (explain mode's marker already taken off). */
const STARTER_ALONE_AT_END = new RegExp(`\\s*\\[SKYCOT: starter (${ID})\\]\\s*$`);

export function starterMarker(id: string): string {
  return `[SKYCOT: starter ${id}]`;
}

/** The message with the card's marker appended; unchanged for an id that is not a kids' card. */
export function withStarterMarker(text: string, id: string | null): string {
  if (id === null || !Object.hasOwn(STARTER_FILE_NAMES, id)) return text;
  return `${text}\n\n${starterMarker(id)}`;
}

/** The card a message came from (null: none). Reads through explain mode's marker after it. */
export function readStarterMarker(text: string): string | null {
  return STARTER_AT_END.exec(text)?.[1] ?? null;
}

/** The message without the card's marker, for text whose explain marker is already off. */
export function stripStarterMarker(text: string): string {
  const match = STARTER_ALONE_AT_END.exec(text);
  return match === null ? text : text.slice(0, match.index);
}

/** What the assistant is told when a message came from this kids' card; null for any other id. */
export function starterRulesFor(id: string | null): string | null {
  if (id === null || !Object.hasOwn(STARTER_FILE_NAMES, id)) return null;
  return [
    "This request came from a SKYCOT starter card, so it also follows these technical rules (they are not shown in the chat; do not repeat them):",
    `- Make it one new file called ${STARTER_FILE_NAMES[id]}, with the HTML, CSS and JavaScript all inside that one file.`,
    "- It must work offline: no internet, no installs, and no pictures, sounds or fonts from websites (draw with CSS, SVG or emoji).",
    "- If a [blank] is left in the request, ask one short question before making anything.",
    "- Then say in one short, friendly sentence what you made.",
  ].join("\n");
}
