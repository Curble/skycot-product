// Friendly display titles for the places a child's work is shown off: fridge magnets, the
// grown-up recap and the printed certificate. The assistant names a conversation like a task
// ("Create an Offline Bubbles Pet Page"); a magnet should read like the thing itself
// ("Bubbles pet page"). Display only: the stored title never changes.

const INSTRUCTION_VERBS = [
  "create",
  "build",
  "make",
  "add",
  "design",
  "draw",
  "write",
  "develop",
  "generate",
  "code",
  "craft",
  "program",
  "produce",
  "implement",
  "set up",
  "put together",
];
const LEADING_VERB = new RegExp(`^(?:${INSTRUCTION_VERBS.join("|")})\\s+`, "i");
const LEADING_ARTICLE = /^(?:an?|the)\s+/i;
/** Words that only say how it was built, not what it is. */
const BUILD_WORDS = /\b(?:offline|simple|basic|interactive|single[- ]file|standalone)\b\s*/gi;
/** "Drawing Page" after the thing drawn: the drawing is the rocket. */
const TRAILING_DRAWING = /\s+(?:drawing|picture|art)\s+(?:page|app|web ?page|website|site)$/i;
const TRAILING_KIND = /\s+(?:page|app|web ?page|website|site)$/i;
/** Kept capitalised mid-title: the people kids make things for. */
const FAMILY_NAMES = new Set([
  "mum",
  "mom",
  "dad",
  "nan",
  "nana",
  "nanna",
  "gran",
  "granny",
  "grandma",
  "grandpa",
  "grandad",
  "granddad",
  "pop",
  "poppy",
  "auntie",
  "aunty",
  "uncle",
]);

function words(text: string): Array<string> {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/** An assistant-written title: Title Case throughout, as the title generator writes them. */
function looksGenerated(title: string): boolean {
  const all = words(title).filter((word) => /^[A-Za-z]/.test(word) && word.length > 3);
  return all.length > 0 && all.every((word) => /^[A-Z]/.test(word));
}

function sentenceCase(text: string): string {
  return words(text)
    .map((word, index) => {
      if (index === 0) return word[0]!.toUpperCase() + word.slice(1);
      const bare = word.replace(/[’']s$/i, "").toLowerCase();
      // Names stay names: possessives ("Nan’s"), family words, acronyms, "I".
      if (/[’']s$/i.test(word) || FAMILY_NAMES.has(bare) || /^[A-Z0-9]{2,}$/.test(word))
        return word;
      if (word === "I" || word.startsWith("I’") || word.startsWith("I'")) return word;
      return word.toLowerCase();
    })
    .join(" ");
}

/**
 * The title to show on a magnet, the recap or a certificate. A title the person gave it
 * (`renamed`) or wrote themselves (not Title Case) is shown as it is; an assistant-written
 * one loses its instruction verb ("Create", "Build"…), how it was built ("Offline") and a
 * trailing "Page"/"App" when what is left still names it.
 */
export function friendlyTitle(title: string, options: { readonly renamed?: boolean } = {}): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length === 0 || options.renamed === true || !looksGenerated(clean)) return clean;
  let text = clean.replace(LEADING_VERB, "");
  text = text.replace(LEADING_ARTICLE, "");
  text = text.replace(BUILD_WORDS, "").replace(/\s+/g, " ").trim();
  text = text.replace(LEADING_ARTICLE, "");
  const withoutDrawing = text.replace(TRAILING_DRAWING, "");
  if (withoutDrawing !== text && words(withoutDrawing).length >= 1) {
    text = withoutDrawing;
  } else {
    const withoutKind = text.replace(TRAILING_KIND, "");
    // "Rocket Star Catcher App" → "Rocket star catcher"; "Bubbles Pet Page" keeps its "page".
    if (withoutKind !== text && words(withoutKind).length >= 3) text = withoutKind;
  }
  // Nothing left but a verb's object like "Page": the original reads better.
  if (words(text).length === 0 || /^(?:page|app|web ?page|website|site)$/i.test(text)) return clean;
  return sentenceCase(text);
}
