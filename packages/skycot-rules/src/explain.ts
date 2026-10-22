// nondev-seam: skycot-rules-package
// "How did you do that?" explain mode. The client says per conversation whether the crew
// should explain its changes; the engine turns that into an instruction for the assistant,
// which ends its turn with a short section the client lifts out into an Explain card.
//
// The choice travels as a marker line at the end of the person's message because a message
// is the only thing every provider, client and the steer path carry. It reads as plain words
// when shown raw (Advanced mode, a provider that never saw the engine strip it), and the
// plain client hides it. Only a choice that differs from the default is sent: explanations
// are on by default in the Family profile and off otherwise.

export type ExplainChoice = "on" | "off";

export const EXPLAIN_ON_MARKER = "[SKYCOT: explain how you did it]";
export const EXPLAIN_OFF_MARKER = "[SKYCOT: no explanation needed]";

const MARKER_AT_END = /\s*\[SKYCOT: (explain how you did it|no explanation needed)\]\s*$/;

/** True when explanations are on unless the message says otherwise. */
export function explainDefault(familyOn: boolean): boolean {
  return familyOn;
}

/** The marker to send for this choice, or null when it is the default anyway. */
export function explainMarkerFor(on: boolean, familyOn: boolean): string | null {
  if (on === explainDefault(familyOn)) return null;
  return on ? EXPLAIN_ON_MARKER : EXPLAIN_OFF_MARKER;
}

/** The message text with the choice appended when it is not the default. */
export function withExplainMarker(text: string, on: boolean, familyOn: boolean): string {
  const marker = explainMarkerFor(on, familyOn);
  return marker === null ? text : `${text}\n\n${marker}`;
}

/** The message without its marker, and the choice it carried (null: the default). */
export function readExplainMarker(text: string): {
  readonly text: string;
  readonly choice: ExplainChoice | null;
} {
  const match = MARKER_AT_END.exec(text);
  if (match === null) return { text, choice: null };
  return {
    text: text.slice(0, match.index),
    choice: match[1] === "explain how you did it" ? "on" : "off",
  };
}

export const EXPLAIN_HEADING = "How I did it";
export const CHECK_HEADING = "Double-check";

/** What the assistant is asked to do while explain mode is on. */
export const EXPLAIN_INSTRUCTIONS = [
  "SKYCOT shows the person a short explanation card after each change, so they learn how it was done.",
  `When this turn creates or changes files, end your final message with this section, last, exactly in this form:`,
  "",
  `**${EXPLAIN_HEADING}:** two to four short sentences in simple words a 9-year-old understands, about one concrete idea from the change (for example: "I used a button tag — it's like a light switch for the page."). No code, no file paths, no jargon.`,
  `**${CHECK_HEADING}:** one short sentence about how you checked that it works.`,
  "",
  "When nothing was changed, leave the section out.",
].join("\n");

export interface Explanation {
  /** The message without the section, for the ordinary bubble. */
  readonly body: string;
  /** "I used a button tag — it's like a light switch for the page." */
  readonly how: string;
  /** "I opened the page and pressed it." Null when the assistant left it out. */
  readonly check: string | null;
}

const EMPHASIS = "(?:\\*\\*|__|\\*|_)?";
const HEADING = new RegExp(
  `(^|\\n)[ \\t]*(?:#{1,6}[ \\t]*)?${EMPHASIS}[ \\t]*how i did (?:it|that)[ \\t]*${EMPHASIS}[ \\t]*:?[ \\t]*${EMPHASIS}[ \\t]*`,
  "gi",
);
const CHECK = new RegExp(
  `(?:^|\\n|[ \\t])[ \\t]*(?:#{1,6}[ \\t]*)?[-*]?[ \\t]*${EMPHASIS}[ \\t]*(?:double[- ]?check(?:ed)?|how i checked(?: it)?)[ \\t]*${EMPHASIS}[ \\t]*:?[ \\t]*${EMPHASIS}[ \\t]*`,
  "i",
);

function tidy(text: string): string {
  return text
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Lifts the "How I did it" section out of an assistant message. The last such heading wins
 * (a message may mention the phrase earlier); null when there is none or it is empty, and the
 * caller then shows the message as it is.
 */
export function parseExplanation(text: string): Explanation | null {
  let last: RegExpExecArray | null = null;
  HEADING.lastIndex = 0;
  for (let match = HEADING.exec(text); match !== null; match = HEADING.exec(text)) last = match;
  if (last === null) return null;
  const start = last.index + last[1]!.length;
  const rest = text.slice(last.index + last[0].length);
  const check = CHECK.exec(rest);
  const how = tidy(check === null ? rest : rest.slice(0, check.index));
  if (how.length === 0) return null;
  const checkText = check === null ? "" : tidy(rest.slice(check.index + check[0].length));
  const body = text
    .slice(0, start)
    .replace(/\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\s*$/, "")
    .trim();
  return { body, how, check: checkText.length > 0 ? checkText : null };
}
