// nondev-seam: skycot-rules-package
// The live preview's shared rules. The engine decides which address the preview may show and
// the plain client draws it; both read "is this address on this Mac?" from here, so the screen
// can never offer what the engine would refuse. Also the "Point at something" block: the words
// a message carries so the assistant knows which part of the page the person means, and the
// reader that lets the plain client show them as a chip instead. And the "preview problem"
// block: what the Preview printed when it would not start, which a child's "Ask Sam to fix it"
// carries to the assistant without the child ever seeing the command or the raw text.

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;
/**
 * scheme, sign-in part, host, port and the rest. Parsed by hand: this package also runs where
 * there is no `URL` (Hermes). Anything unusual (escapes, backslashes, odd hosts) fails to match
 * and is treated as not this Mac.
 */
const WEB_ADDRESS =
  /^(https?):\/\/(?:([^@/?#\\]*)@)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?([/?#][^\s]*)?$/i;

interface WebAddress {
  readonly scheme: string;
  readonly host: string;
  readonly port: number | null;
  readonly rest: string;
}

function parseWebAddress(value: string): WebAddress | null {
  const match = WEB_ADDRESS.exec(value.trim());
  if (match === null || match[2] !== undefined) return null;
  const port = match[4] === undefined ? null : Number(match[4]);
  if (port !== null && (port < 1 || port > 65_535)) return null;
  return {
    scheme: match[1]!.toLowerCase(),
    host: match[3]!.toLowerCase(),
    port,
    rest: match[5] ?? "",
  };
}

const isLoopbackHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  LOOPBACK_V4.test(host) ||
  host === "[::1]" ||
  host === "0.0.0.0";

/** True for an address served by this Mac itself (loopback), the only kind the preview shows on its own. */
export function isLocalPreviewAddress(value: string): boolean {
  const address = parseWebAddress(value);
  return address !== null && isLoopbackHost(address.host);
}

// Colour and cursor codes a dev server prints into its terminal.
// oxlint-disable-next-line no-control-regex -- terminal escape sequences are control characters
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** The terminal's text without colour codes, for reading and for showing a grown-up. */
export function plainTerminalText(text: string): string {
  return text.replace(ANSI, "").replace(/\r\n?/g, "\n");
}

const URL_IN_TEXT = /https?:\/\/[^\s'"<>`)\]]+/g;
const PORT_IN_TEXT =
  /\b(?:listening|running|started|serving|ready|available)\b[^\n]{0,60}?(?:\bport\b\s*:?\s*|:)(\d{2,5})\b/i;

/**
 * The first address on this Mac a dev server says it is serving ("Local: http://localhost:5173/").
 * A server bound to every network card (0.0.0.0, ::) is opened as localhost; addresses on other
 * computers are ignored.
 */
export function localAddressFromOutput(output: string): string | null {
  const text = plainTerminalText(output);
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const address = parseWebAddress(match[0].replace(/[.,;:]+$/, ""));
    if (address === null) continue;
    const host = address.host === "0.0.0.0" || address.host === "[::]" ? "localhost" : address.host;
    if (!isLoopbackHost(host)) continue;
    const rest = address.rest.length === 0 ? "/" : address.rest;
    return `${address.scheme}://${host}${address.port === null ? "" : `:${address.port}`}${rest}`;
  }
  const port = PORT_IN_TEXT.exec(text)?.[1];
  if (port !== undefined) {
    const value = Number(port);
    if (value > 0 && value < 65536) return `http://localhost:${value}/`;
  }
  return null;
}

/** One thing the person pointed at in the preview. */
export interface Pointer {
  /** "the big pink title": what the chip says. */
  readonly label: string;
  readonly pageUrl: string;
  readonly tagName: string;
  readonly selector: string | null;
  /** A short piece of the element's HTML, so the assistant can find it in the files. */
  readonly html: string;
}

export const MAX_POINTERS = 3;
const POINTER_LINE = /^\[SKYCOT pointing at: (.+)\]$/;
const HTML_MAX = 300;
const LABEL_MAX = 80;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
// A label must not close its own bracket, or the reader would cut it short.
const cleanLabel = (label: string) => oneLine(label.replace(/[[\]]/g, ""), LABEL_MAX) || "this";

/**
 * The message the assistant receives: what the person typed, then one block per thing they
 * pointed at. The block reads as plain words where it is shown raw (Advanced mode), and the
 * plain client lifts it out into chips (`readPointing`).
 */
export function withPointing(text: string, pointers: ReadonlyArray<Pointer>): string {
  if (pointers.length === 0) return text;
  const blocks = pointers
    .slice(0, MAX_POINTERS)
    .map((pointer) =>
      [
        `[SKYCOT pointing at: ${cleanLabel(pointer.label)}]`,
        `- Page: ${oneLine(pointer.pageUrl, 300)}`,
        `- Element: <${oneLine(pointer.tagName, 40)}>${
          pointer.selector ? `, selector \`${oneLine(pointer.selector, 200)}\`` : ""
        }`,
        `- Looks like: ${oneLine(pointer.html, HTML_MAX)}`,
      ].join("\n"),
    );
  const intro = "(The person pointed at this part of the preview; it is what they mean.)";
  const typed = text.trimEnd();
  return `${typed}${typed.length > 0 ? "\n\n" : ""}${blocks.join("\n\n")}\n${intro}`;
}

/** What the Preview said when it would not start, for the assistant and not the child. */
export interface PreviewProblem {
  /** "The preview didn't start." */
  readonly what: string;
  /** "It runs `npm run dev`." */
  readonly how: string;
  /** What the start printed (plain terminal text; may be empty). */
  readonly output: string;
}

const PROBLEM_LINE = /^\[SKYCOT preview problem\]$/;
/** Terminal text is cut to its tail (where the error is) so a noisy start cannot flood a turn. */
export const PROBLEM_OUTPUT_MAX = 6000;

/**
 * The message the assistant receives when a child asked to fix the Preview: what they sent,
 * then one block with the command and what it printed. Reads as plain words where it is shown
 * raw (Advanced mode); the plain client hides it (`readPointing` cuts the message there).
 */
export function withPreviewProblem(text: string, problem: PreviewProblem | null): string {
  if (problem === null) return text;
  const said = plainTerminalText(problem.output).trim();
  const tail = said.length > PROBLEM_OUTPUT_MAX ? `…${said.slice(-PROBLEM_OUTPUT_MAX)}` : said;
  // A fence longer than any run of backticks inside the output cannot be closed by it.
  const longest = Math.max(0, ...(tail.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const typed = text.trimEnd();
  return [
    `${typed}${typed.length > 0 ? "\n\n" : ""}[SKYCOT preview problem]`,
    `- ${oneLine(problem.what, 200)} ${oneLine(problem.how, 200)}`,
    ...(tail.length > 0 ? ["- What it said:", fence, tail, fence] : []),
    "(The person has not seen this; it is what happened when their preview did not work.)",
  ].join("\n");
}

/** The typed words without the pointing and preview-problem blocks, and the chips' labels. */
export function readPointing(text: string): {
  readonly text: string;
  readonly labels: ReadonlyArray<string>;
} {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => POINTER_LINE.test(line) || PROBLEM_LINE.test(line));
  if (first === -1) return { text, labels: [] };
  const labels = lines.flatMap((line) => {
    const match = POINTER_LINE.exec(line);
    return match ? [match[1]!] : [];
  });
  return { text: lines.slice(0, first).join("\n").trimEnd(), labels };
}
