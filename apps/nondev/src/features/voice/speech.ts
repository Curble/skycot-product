// The pure half of "Talk to SKYCOT": what a reply sounds like when read aloud, which of the
// Mac's voices reads it, and who turns speech into text in this browser. Nothing here touches
// `window`; the browser objects are passed in so every rule is testable.

/** Long replies are cut here; the rest stays on screen. */
export const SPOKEN_MAX_CHARS = 900;

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // Provider keys and tokens: sk-…, ghp_…, xoxb-…, AKIA…, JWTs.
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Any long run of key-looking characters (hex, base64) with a digit in it.
  /\b(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}/g,
];

// `password: hunter2`, `token=abc…`: keep the word, drop the value.
const LABELLED_SECRET = /\b(password|passcode|token|secret|api[ _-]?key)(\s*[:=]\s*)\S+/gi;

const URL_PATTERN = /\bhttps?:\/\/[^\s)>\]]+/gi;
// `src/app.ts`, `./index.html`, `/Users/kid/Desktop/game.html`, `~/x.json`, bare `game.html`;
// not "and/or" or "24/7".
const PATH_PATTERN = new RegExp(
  [
    String.raw`(?:~|\.{1,2})(?:\/[\w.@-]+)+\/?`,
    String.raw`(?<![\w>])(?:\/[\w.@-]+){2,}\/?`,
    String.raw`\b[\w@-]+(?:\/[\w@.-]+){2,}`,
    String.raw`\b(?:[\w@-]+\/)*[\w@-]+\.(?:html?|css|js|jsx|ts|tsx|json|md|txt|py|svg|png|jpe?g|gif|sh|ya?ml|toml|lock)\b`,
  ].join("|"),
  "gi",
);
const IS_PATH = new RegExp(PATH_PATTERN.source, "i");

/**
 * What the reader hears for a Crew reply: no Markdown marks, no code read out symbol by
 * symbol, and never a secret, address or file path verbatim — they become "a secret", "a
 * link" and "a file". Returns "" when nothing speakable is left.
 */
export function spokenText(markdown: string, maxChars = SPOKEN_MAX_CHARS): string {
  let text = markdown.replace(/\r\n?/g, "\n");
  // Fenced code: one mention, not the code.
  let hadCode = false;
  text = text.replace(/```[\s\S]*?(?:```|$)/g, () => {
    hadCode = true;
    return "\n";
  });
  // Markdown links: keep the words, drop the address.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt ? `a picture of ${alt}` : "a picture",
  );
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(URL_PATTERN, "a link");
  text = text.replace(LABELLED_SECRET, "$1 (a secret)");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "a secret");
  // Inline code: a path or file name becomes "a file"; a short word is read; the rest is dropped.
  text = text.replace(/`([^`\n]+)`/g, (_m, inner: string) => {
    const trimmed = inner.trim();
    if (IS_PATH.test(trimmed)) return "a file";
    return /^[\w\s'-]{1,24}$/.test(trimmed) ? trimmed : "some code";
  });
  text = text.replace(PATH_PATTERN, "a file");
  text = text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        .replace(/^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+/, "")
        .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/, "")
        .replace(/\|/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0)
    // A list item or heading is its own sentence when read aloud.
    .map((line) => (/[.!?:;,…]$/.test(line) ? line : `${line}.`))
    .join(" ");
  text = text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/[*_~`#<>]/g, "")
    // "a file, a file and a file" reads like a stammer.
    .replace(/\b(a file)(?:[,\s]+(?:and\s+)?a file)+\b/g, "some files")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.!?])\.+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (hadCode)
    text =
      text.length > 0 ? `${text} There's some code on screen too.` : "There's some code on screen.";
  if (text === ".") return "";
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const sentenceEnd = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
    );
    const kept =
      sentenceEnd > maxChars / 2
        ? cut.slice(0, sentenceEnd + 1)
        : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
    return `${kept} There's more on screen.`;
  }
  return text;
}

/** The parts of `SpeechSynthesisVoice` the picker reads. */
export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

// macOS ships novelty voices (Bad News, Bells, Zarvox…) that would frighten or confuse a child.
const NOVELTY =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|pipe organ|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|kathy|grandma|grandpa|rocko|eddy|flo|reed|sandy|shelley)\b/i;
// Warm, clear voices that ship with recent macOS, best first per accent.
const FRIENDLY =
  /\b(karen|lee|catherine|matilda|serena|kate|daniel|martha|samantha|ava|allison|susan|zoe|nicky)\b/i;
const ACCENT_ORDER = ["en-AU", "en-GB", "en-US", "en-NZ", "en-IE", "en-CA", "en-ZA", "en-IN"];

/**
 * A friendly English voice that runs on this Mac: the person's own English accent first when
 * they have one, then Australian, British, American. On-device voices beat network ones (a
 * read-aloud should never send the reply anywhere). Returns null when there is no English
 * voice; the browser default then speaks.
 */
export function pickVoice(
  voices: ReadonlyArray<VoiceLike>,
  preferredLang?: string,
): VoiceLike | null {
  const english = voices.filter(
    (voice) => /^en([-_]|$)/i.test(voice.lang) && !NOVELTY.test(voice.name),
  );
  if (english.length === 0) return null;
  const normal = (lang: string) => lang.replace("_", "-").toLowerCase();
  const order = [
    ...(preferredLang && /^en-/i.test(preferredLang) ? [preferredLang] : []),
    ...ACCENT_ORDER,
  ].map(normal);
  const score = (voice: VoiceLike) => {
    const accent = order.indexOf(normal(voice.lang));
    return (
      (voice.localService ? 0 : 1000) +
      (accent === -1 ? 100 : accent * 10) +
      (FRIENDLY.test(voice.name) ? 0 : 5) +
      (/enhanced|premium/i.test(voice.name) ? -1 : 0)
    );
  };
  return [...english].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0]!;
}

/** A touch slower for a child; ordinary pace otherwise. */
export function speakingRate(family: boolean): number {
  return family ? 0.9 : 1;
}

/** Who turns speech into text in this browser, as far as the browser lets us tell. */
export type SpeechService = "apple" | "google" | "microsoft" | "browser" | "none";

/**
 * The Web Speech API does not say where the audio goes, so this reads the browser: Safari's
 * recogniser is Apple's dictation, Chrome's sends audio to Google, Edge's to Microsoft. The
 * desktop app's window (Electron) has the API but no speech service behind it, and Firefox has
 * no recogniser at all: both are "none", so the microphone is not offered there.
 */
export function speechServiceFor(input: {
  readonly userAgent: string;
  readonly hasRecognition: boolean;
  readonly electron: boolean;
}): SpeechService {
  if (!input.hasRecognition || input.electron || /\bElectron\//.test(input.userAgent))
    return "none";
  const ua = input.userAgent;
  if (/\bEdg\//.test(ua)) return "microsoft";
  if (/\b(OPR|Brave|Vivaldi|YaBrowser|SamsungBrowser)\//.test(ua)) return "browser";
  if (/(Chrome|CriOS)\//.test(ua)) return "google";
  if (/\bSafari\//.test(ua) || /\bAppleWebKit\//.test(ua)) return "apple";
  return "browser";
}

/**
 * Sentences grouped into pieces of about `size` characters. Chrome cuts a single long
 * utterance off after roughly fifteen seconds, so a reply is queued as several short ones.
 */
export function speechChunks(text: string, size = 220): ReadonlyArray<string> {
  const sentences = text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) ?? [];
  const chunks: Array<string> = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length === 0) continue;
    if (current.length > 0 && current.length + sentence.length + 1 > size) {
      chunks.push(current);
      current = "";
    }
    current = current.length === 0 ? sentence : `${current} ${sentence}`;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * The English accent to listen and speak in. Many Australian Macs report en-GB or en-US as the
 * browser language, so an Australian or New Zealand time zone decides first.
 */
export function preferredEnglish(language: string, timeZone: string): string {
  if (/^Australia\//.test(timeZone)) return "en-AU";
  if (timeZone === "Pacific/Auckland" || timeZone === "Pacific/Chatham") return "en-NZ";
  return /^en(-|$)/i.test(language) ? language : "en-AU";
}
