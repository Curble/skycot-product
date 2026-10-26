// nondev-seam: skycot-iphone-q39-starter-placeholders
export interface StarterPlaceholder {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function starterPlaceholders(text: string): Array<StarterPlaceholder> {
  return [...text.matchAll(/\[([^\]\n]+)\]/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
