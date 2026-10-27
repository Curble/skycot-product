// Reading a fridge card's text safely; no engine or browser code here, so the phone shares it.

/** The card only if it really is an SVG picture; anything else is treated as "no card". */
export function parseMagnetCard(text: string): string | null {
  return /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/iu.test(text) ? text : null;
}

/** The text of an SVG as an <img> source. An image never runs scripts, whatever the text holds. */
export function cardImageSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
