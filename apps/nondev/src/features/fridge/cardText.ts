// Reading a fridge card's text safely; no engine or browser code here, so the phone shares it.

/** The card only if it really is an SVG picture; anything else is treated as "no card". */
export function parseMagnetCard(text: string): string | null {
  return /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/iu.test(text) ? text : null;
}

/** The text of an SVG as an <img> source. An image never runs scripts, whatever the text holds. */
export function cardImageSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * The card's own background colour (its first filled rectangle), so the tile around a 16:9 card
 * is matted in the same colour instead of dark bars. Only a plain hex colour is accepted; anything
 * else (a url(), a gradient, nothing at all) means "no mat". The phone does the same with its tile.
 */
export function cardMatColor(svg: string): string | null {
  const fill = svg.match(/<rect\b[^>]*\bfill="(#[\da-f]{3}(?:[\da-f]{3})?)"/iu)?.[1];
  return fill ?? null;
}
