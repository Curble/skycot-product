// Find inside a conversation: the plain logic. No React, no server. The find bar counts what it
// can see on the page; these helpers turn a word into spots in a text, step between matches, and
// cut a text into plain and highlighted pieces.

export interface FindSpan {
  readonly start: number;
  readonly end: number;
}

export interface FindSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface FindHit extends FindSpan {
  /** Which message (its position in the list handed in). */
  readonly index: number;
}

/** Ignore capitals and surrounding spaces; an empty word finds nothing. */
export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Every spot where the word appears in one text, left to right, never overlapping. */
export function findSpans(text: string, query: string): ReadonlyArray<FindSpan> {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return [];
  // Lower-casing can change a text's length for a few letters; search a copy only when it can't.
  const haystack = text.toLocaleLowerCase();
  if (haystack.length !== text.length) return [];
  const spans: Array<FindSpan> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    spans.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return spans;
}

/** Every match across a list of message texts, in reading order. */
export function findMatches(texts: ReadonlyArray<string>, query: string): ReadonlyArray<FindHit> {
  return texts.flatMap((text, index) => findSpans(text, query).map((span) => ({ index, ...span })));
}

/** Cut a text into plain and matching pieces; the pieces joined give the text back. */
export function splitHighlights(text: string, query: string): ReadonlyArray<FindSegment> {
  const spans = findSpans(text, query);
  if (spans.length === 0) return text.length === 0 ? [] : [{ text, match: false }];
  const segments: Array<FindSegment> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), match: false });
    segments.push({ text: text.slice(span.start, span.end), match: true });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** Next (1) or previous (-1) match, wrapping round at either end. Null when there are none. */
export function stepMatch(current: number | null, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** "2 of 5", "No matches", or nothing while the box is empty. */
export function matchCountLabel(query: string, current: number | null, count: number): string {
  if (normalizeQuery(query).length === 0) return "";
  if (count === 0 || current === null) return count === 0 ? "No matches" : `${count} found`;
  return `${current + 1} of ${count}`;
}
