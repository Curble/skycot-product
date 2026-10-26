// nondev-seam: skycot-iphone-q39-display-text
/** Removes hidden SKYCOT instructions before conversation text reaches a child's screen. */
export function visibleMessageText(text: string): string {
  let visible = "";
  for (let index = 0; index < text.length;) {
    if (!text.startsWith("[SKYCOT:", index)) {
      visible += text[index];
      index += 1;
      continue;
    }
    let depth = 0;
    let end = index;
    for (; end < text.length; end += 1) {
      if (text[end] === "[") depth += 1;
      if (text[end] === "]") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    if (depth === 0) index = end;
    else {
      visible += text[index];
      index += 1;
    }
  }
  return visible
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\s+([,.;!?])/gu, "$1")
    .trim();
}
