/**
 * A first name for a new conversation, until the Mac's AI writes a better one: "Please make a
 * simple space game with a rocket and stars" → "A simple space game". The child's own words,
 * shortened; never anything they didn't write.
 */
const LEADING =
  /^(?:(?:please|can you|could you|i want you to|i'd like you to|let's)\s+)*(?:(?:make|build|create|draw|write|do)\s+(?:me\s+|us\s+)?)?/iu;
const STOP = /\s(?:with|that|which|where|so|and then|using|for my|for me)\s|[,.;:!?]/iu;

export function titleFrom(text: string): string {
  const first = (text.split("\n")[0] ?? "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  let core = first.replace(LEADING, "");
  const stop = STOP.exec(core);
  if (stop !== null && stop.index > 2) core = core.slice(0, stop.index);
  const words = core.trim().split(" ").filter(Boolean).slice(0, 6).join(" ");
  if (words.length === 0) return first.length > 0 ? first.slice(0, 40) : "A new idea";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
