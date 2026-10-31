// nondev-seam: skycot-plan-grownup-note
/**
 * Display only: does any numbered step of a plan look like it will fetch or install
 * something from outside the project? Only numbered step lines are read (the same rule
 * as kidSafePlan), so prose around the steps never triggers it. This changes no approval
 * or hold logic; the safety engine decides on its own when the step runs.
 */
const OUTSIDE_STEP =
  /\b(?:install(?:s|ed|ing)?|download(?:s|ed|ing)?|npm|pnpm|yarn|pip3?|brew|curl|wget|packages?|internet|add-on|addon|libraries|library)\b|https?:\/\//iu;

export function planMayNeedGrownUp(markdown: string): boolean {
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\s*\d+[.)]\s+/u.test(line))
    .some((line) => OUTSIDE_STEP.test(line));
}
