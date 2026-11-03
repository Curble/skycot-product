// How a plan's text is read on the card. Assistants sometimes squeeze numbered steps onto one
// line ("1. Add a title; 2. Use white; 3. Check it.") and, while a plan waits in plan mode,
// often write the same plan again after answering a question.

const INLINE_STEP = /;\s*(?=(\d{1,2})[.)]\s)/gu;

/** Puts squeezed steps on their own lines, only when they count up 1, 2, 3 from the line's start. */
export function splitInlineSteps(markdown: string): string {
  return markdown
    .split(/\r?\n/u)
    .map((line) => {
      const first = /^(\s*)(\d{1,2})[.)]\s/u.exec(line);
      if (first === null) return line;
      let expected = Number(first[2]) + 1;
      const cuts: Array<number> = [];
      for (const match of line.matchAll(INLINE_STEP)) {
        if (match.index === undefined || match.index < first[0].length) continue;
        if (Number(match[1]) !== expected) continue;
        cuts.push(match.index);
        expected += 1;
      }
      if (cuts.length === 0) return line;
      const parts: Array<string> = [];
      let from = 0;
      for (const cut of cuts) {
        parts.push(line.slice(from, cut));
        from = cut;
      }
      parts.push(line.slice(from));
      return parts
        .map((part, index) => (index === 0 ? part : first[1] + part.replace(/^;\s*/u, "")))
        .join("\n");
    })
    .join("\n");
}

function sameWords(markdown: string): string {
  return splitInlineSteps(markdown).replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * The next plan written after this one says exactly the same thing: the earlier copy is not
 * news (Sam answered a question and showed the plan again), so the card can step aside.
 */
export function shownAgainLater(
  item: { readonly ordinal: number; readonly markdown: string },
  items: ReadonlyArray<{
    readonly type: string;
    readonly ordinal: number;
    readonly markdown?: string | undefined;
  }>,
): boolean {
  const next = items
    .filter((candidate) => candidate.type === "proposed_plan" && candidate.ordinal > item.ordinal)
    .reduce<(typeof items)[number] | undefined>(
      (soonest, candidate) =>
        soonest === undefined || candidate.ordinal < soonest.ordinal ? candidate : soonest,
      undefined,
    );
  return next?.markdown !== undefined && sameWords(next.markdown) === sameWords(item.markdown);
}

const PLAN_TAG_BLOCK = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/giu;
const ESCAPED_PLAN_TAG_BLOCK = /&lt;proposed_plan&gt;([\s\S]*?)&lt;\/proposed_plan&gt;/giu;

/**
 * A plan that arrives as plain message text still wrapped in its tags (the engine normally
 * turns it into a plan card first) shows its steps as ordinary words, never the tags. This
 * only tidies the words; a "Build it" button belongs to real plan items alone.
 */
export function unwrapProposedPlanTags(text: string): string {
  if (!/proposed_plan/iu.test(text)) return text;
  return text
    .replace(PLAN_TAG_BLOCK, (_, inner: string) => `\n${inner.trim()}\n`)
    .replace(ESCAPED_PLAN_TAG_BLOCK, (_, inner: string) => `\n${inner.trim()}\n`)
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
