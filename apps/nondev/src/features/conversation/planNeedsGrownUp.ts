// nondev-seam: skycot-plan-grownup-note
/**
 * Display only: does any numbered step of a plan look like it will fetch or install
 * something from outside the project? Only numbered step lines are read (the same rule
 * as kidSafePlan), so prose around the steps never triggers it. This changes no approval
 * or hold logic; the safety engine decides on its own when the step runs.
 */
const OUTSIDE_WORD =
  "(?:install(?:s|ed|ing)?|download(?:s|ed|ing)?|npm|pnpm|yarn|pip3?|brew|curl|wget|packages?|internet|add-ons?|addons?|libraries|library)";
const OUTSIDE_STEP = new RegExp(`\\b${OUTSIDE_WORD}\\b|https?:\\/\\/`, "iu");
// "works without internet", "no downloads", "doesn't need any add-ons": a negator and up to
// three words before the outside word. Removed before testing, so a starter's own
// "no internet" promise does not raise the note on a plain plan.
const NEGATED = new RegExp(
  `\\b(?:without|no|not|never|nothing|don't|doesn't|won't)\\b(?:\\s+[\\w'-]+){0,3}?\\s+${OUTSIDE_WORD}\\b`,
  "giu",
);

export function planMayNeedGrownUp(markdown: string): boolean {
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\s*\d+[.)]\s+/u.test(line))
    .some((line) => OUTSIDE_STEP.test(line.replace(NEGATED, " ")));
}
