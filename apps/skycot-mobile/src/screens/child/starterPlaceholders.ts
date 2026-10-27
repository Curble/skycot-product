// nondev-seam: skycot-iphone-q39-starter-placeholders
export interface StarterPlaceholder {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface StarterDraft {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
}

export function selectStarterPlaceholder(text: string, start: number, end: number): StarterDraft {
  return { text, selection: { start, end } };
}

export function replaceSelectedStarterText(
  text: string,
  selection: StarterDraft["selection"],
  replacement: string,
): StarterDraft {
  const nextText = text.slice(0, selection.start) + replacement + text.slice(selection.end);
  return updateStarterDraft(text, selection, nextText);
}

export function updateStarterDraft(
  previousText: string,
  selection: StarterDraft["selection"],
  nextText: string,
): StarterDraft {
  const replaced = selection.end - selection.start;
  const inserted = nextText.length - (previousText.length - replaced);
  const caret = Math.max(0, Math.min(nextText.length, selection.start + inserted));
  return { text: nextText, selection: { start: caret, end: caret } };
}

export function starterPlaceholders(text: string): Array<StarterPlaceholder> {
  return [...text.matchAll(/\[([^\]\n]+)\]/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
