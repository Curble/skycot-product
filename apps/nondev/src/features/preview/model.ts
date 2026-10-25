// The live preview as the plain client sees it: the engine's answer about one conversation's
// site, where it can be drawn on this device, and the plain words for what the person pointed
// at ("the big pink title"). Pure, so every rule here is tested without a browser.
import {
  isLocalPreviewAddress,
  type Pointer,
  type PreviewProblem,
} from "@t3tools/skycot-rules/preview";

export interface PreviewCommandView {
  readonly runner: string;
  readonly script: string;
  /** A plain web page SKYCOT shows itself (an index.html, no start script): nothing runs. */
  readonly page?: true;
  /** For a plain page: the folder SKYCOT shows, inside the project ("" for the folder itself). */
  readonly pageFolder?: string;
}

export type StartDecisionView =
  | { readonly kind: "start" }
  | { readonly kind: "ask" | "grown-up"; readonly reasons: ReadonlyArray<string> };

export type PreviewStatusView =
  | { readonly state: "no-folder" }
  | { readonly state: "no-site" }
  | {
      readonly state: "ready";
      readonly command: PreviewCommandView;
      readonly decision: StartDecisionView;
      readonly requestId: string;
    }
  | { readonly state: "starting"; readonly command: PreviewCommandView }
  | {
      readonly state: "running";
      readonly command: PreviewCommandView;
      readonly url: string;
      readonly frameable: boolean;
      /** Family profile: pages that tried internet sites no grown-up allowed yet. */
      readonly internetAsks: ReadonlyArray<InternetAsk>;
    }
  | {
      readonly state: "failed";
      readonly command: PreviewCommandView;
      readonly reason: "exited" | "no-address";
      readonly output: string;
    }
  /** It was showing, then its program ended: not a start that failed. */
  | { readonly state: "stopped"; readonly command: PreviewCommandView; readonly output: string };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : null);

function parseCommand(value: unknown): PreviewCommandView | null {
  const command = record(value);
  const runner = text(command?.["runner"]);
  if (!command || !runner) return null;
  const script = text(command["script"]) ?? runner;
  if (command["source"] !== "static") return { runner, script };
  // The engine names the folder; its script ("public/index.html") says the same thing.
  const pageFolder =
    text(command["pageFolder"]) ?? /^(.*?)\/?index\.html$/i.exec(script)?.[1] ?? null;
  return pageFolder === null
    ? { runner, script, page: true }
    : { runner, script, page: true, pageFolder };
}

function parseDecision(value: unknown): StartDecisionView | null {
  const decision = record(value);
  const kind = decision?.["kind"];
  if (kind === "start") return { kind };
  if (kind !== "ask" && kind !== "grown-up") return null;
  const reasons = Array.isArray(decision?.["reasons"])
    ? (decision["reasons"] as ReadonlyArray<unknown>).filter(
        (reason): reason is string => typeof reason === "string",
      )
    : [];
  return { kind, reasons };
}

/** The engine's status, or null when the answer is not one (an older engine, a proxy page). */

/** One page that tried internet sites: its path on the Mac and the sites, as the engine named them. */
export interface InternetAsk {
  readonly page: string;
  readonly sites: ReadonlyArray<string>;
}

function parseInternetAsks(value: unknown): ReadonlyArray<InternetAsk> {
  if (!Array.isArray(value)) return [];
  const asks: Array<InternetAsk> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const ask = item as Record<string, unknown>;
    const sites = Array.isArray(ask["sites"])
      ? ask["sites"].filter((site): site is string => typeof site === "string")
      : [];
    if (typeof ask["page"] === "string" && sites.length > 0)
      asks.push({ page: ask["page"], sites });
  }
  return asks;
}

export function parsePreviewStatus(body: unknown): PreviewStatusView | null {
  const status = record(body);
  const state = status?.["state"];
  if (status === null) return null;
  if (state === "no-folder" || state === "no-site") return { state };
  const command = parseCommand(status["command"]);
  if (command === null) return null;
  switch (state) {
    case "ready": {
      const decision = parseDecision(status["decision"]);
      const requestId = text(status["requestId"]);
      return decision && requestId ? { state, command, decision, requestId } : null;
    }
    case "starting":
      return { state, command };
    case "running": {
      const url = text(status["url"]);
      // The engine only ever names this Mac's own addresses; anything else is not drawn.
      return url && isLocalPreviewAddress(url)
        ? {
            state,
            command,
            url,
            frameable: status["frameable"] !== false,
            internetAsks: parseInternetAsks(status["internetAsks"]),
          }
        : null;
    }
    case "failed":
      return {
        state,
        command,
        reason: status["reason"] === "no-address" ? "no-address" : "exited",
        output: text(status["output"]) ?? "",
      };
    case "stopped":
      return { state, command, output: text(status["output"]) ?? "" };
    default:
      return null;
  }
}

/**
 * Where the running site can be shown on this device:
 * - `desktop`: the Mac app's own preview browser (Point at something works here);
 * - `frame`: a browser on this Mac, inside SKYCOT's window;
 * - `outside`: a browser on this Mac, but the site refuses to be framed;
 * - `elsewhere`: another device (a phone): the address belongs to the Mac, not to it.
 */
export type PreviewSurface = "desktop" | "frame" | "outside" | "elsewhere";

const LOOPBACK_HOST = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

export function previewSurface(input: {
  readonly hasDesktopPreview: boolean;
  /** Where SKYCOT itself was loaded from (`window.location`). */
  readonly page: { readonly hostname: string; readonly origin: string };
  readonly url: string;
  readonly frameable: boolean;
}): PreviewSurface {
  if (input.hasDesktopPreview) return "desktop";
  if (!LOOPBACK_HOST.test(input.page.hostname)) return "elsewhere";
  // A frame of SKYCOT's own origin could lift its sandbox and act as the app: never.
  let sameOrigin = false;
  try {
    sameOrigin = new URL(input.url).origin === input.page.origin;
  } catch {}
  return input.frameable && !sameOrigin ? "frame" : "outside";
}

/** Whether the Preview's address (this Mac's own) works on this device: not on a phone. */
export function previewAddressWorksHere(input: {
  readonly hasDesktopPreview: boolean;
  readonly hostname: string;
}): boolean {
  return input.hasDesktopPreview || LOOPBACK_HOST.test(input.hostname);
}

/** "localhost:5173" for the toolbar: the address without its scheme or a bare trailing slash. */
export function shortAddress(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export const CHILD_FIX_IT_MESSAGE = "The preview didn't work. Can you fix it?";

/**
 * What went wrong, in the words the assistant needs: the command, and what the start printed.
 * A grown-up reads it in the message box; a child never does (see `fixItMessage`) and it
 * travels as a hidden block instead (`withPreviewProblem`).
 */
export function fixItDetails(
  status: PreviewStatusView & { readonly state: "failed" | "stopped" },
): PreviewProblem {
  const what =
    status.state === "stopped"
      ? "The preview was working, then it stopped by itself."
      : status.reason === "no-address"
        ? "The preview didn't start: it ran but never opened a page I could see."
        : "The preview didn't start.";
  const how = status.command.page
    ? `It shows \`${status.command.script}\` as a plain page.`
    : `It runs \`${status.command.runner}\`.`;
  return { what, how, output: status.output.trim() };
}

/**
 * The message the "Ask Sam to fix it" button puts in the box, ready to send. A child sees
 * one friendly sentence; the command and the raw output go as hidden context
 * (`fixItDetails`), so no developer text lands in their box or their bubble.
 */
export function fixItMessage(
  status: PreviewStatusView & { readonly state: "failed" | "stopped" },
  childView = false,
): string {
  if (childView) return CHILD_FIX_IT_MESSAGE;
  const { what, how, output } = fixItDetails(status);
  return [
    `${what} Can you fix it so the preview works? ${how}`,
    ...(output.length > 0 ? ["", "Here's what it said:", "```", output, "```"] : []),
  ].join("\n");
}

export const SET_UP_MESSAGE =
  "Can you set this project up so I can see it in the Preview? An index.html page in the project folder is enough, without installing anything.";

/** The parts of T3's picked element (PickedElementPayload) the chip is made from. */
export interface PickedElement {
  readonly tagName: string;
  readonly htmlPreview: string;
  readonly styles: string;
  readonly selector: string | null;
  readonly pageUrl: string;
  readonly rect: { readonly width: number; readonly height: number };
}

const NOUNS: Readonly<Record<string, string>> = {
  h1: "title",
  h2: "heading",
  h3: "heading",
  h4: "small heading",
  h5: "small heading",
  h6: "small heading",
  p: "text",
  span: "words",
  strong: "words",
  em: "words",
  b: "words",
  i: "words",
  small: "words",
  label: "label",
  button: "button",
  a: "link",
  img: "picture",
  picture: "picture",
  svg: "drawing",
  canvas: "drawing area",
  video: "video",
  input: "box",
  textarea: "box",
  select: "drop-down",
  li: "list item",
  ul: "list",
  ol: "list",
  nav: "menu",
  header: "top part",
  footer: "bottom part",
  table: "table",
  form: "form",
  body: "page",
  html: "page",
};

/** Lines like `color: rgb(255, 105, 180);` from T3's picker, or the element's own style="". */
function readStyles(element: PickedElement): ReadonlyMap<string, string> {
  const styles = new Map<string, string>();
  const inline = /\sstyle\s*=\s*"([^"]*)"/i.exec(element.htmlPreview.split(">")[0] ?? "")?.[1];
  for (const source of [inline ?? "", element.styles]) {
    for (const part of source.split(/[;\n]/)) {
      const colon = part.indexOf(":");
      if (colon <= 0) continue;
      const name = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).trim();
      if (name.length > 0 && value.length > 0) styles.set(name, value);
    }
  }
  return styles;
}

const NAMED: Readonly<Record<string, [number, number, number]>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  pink: [255, 192, 203],
  hotpink: [255, 105, 180],
  orange: [255, 165, 0],
  yellow: [255, 255, 0],
  gold: [255, 215, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  purple: [128, 0, 128],
  violet: [238, 130, 238],
  brown: [165, 42, 42],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  teal: [0, 128, 128],
  cyan: [0, 255, 255],
};

function parseColor(value: string): [number, number, number] | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent" || trimmed.startsWith("rgba(0, 0, 0, 0)")) return null;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(trimmed);
  if (rgb) {
    const alpha =
      rgb[4] === undefined ? 1 : Number.parseFloat(rgb[4]) / (rgb[4].endsWith("%") ? 100 : 1);
    if (alpha < 0.2) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/.exec(trimmed)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  return NAMED[trimmed] ?? null;
}

/** The plain colour word for an RGB colour, the way a child would say it. */
export function colorName([r, g, b]: readonly [number, number, number]): string {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (lightness < 0.13) return "black";
  if (lightness > 0.93) return "white";
  if (saturation < 0.18) return lightness > 0.6 ? "light grey" : "grey";
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  let hue =
    max === rf
      ? ((gf - bf) / delta) % 6
      : max === gf
        ? (bf - rf) / delta + 2
        : (rf - gf) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 12 || hue >= 345) return lightness > 0.7 ? "pink" : "red";
  if (hue < 40) return lightness < 0.35 ? "brown" : "orange";
  if (hue < 65) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "teal";
  if (hue < 255) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const QUOTE_MAX = 28;

/** Up to a whole word near the limit, so the chip never ends half-way through one. */
function shortQuote(quote: string): string {
  if (quote.length <= QUOTE_MAX) return quote;
  const cut = quote.slice(0, QUOTE_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 10 ? cut.slice(0, space) : cut.slice(0, QUOTE_MAX)).trimEnd()}…`;
}

/** "the big pink title “Welcome to my pet page”": what the chip says about a picked element. */
export function describePickedElement(element: PickedElement): string {
  const tag = element.tagName.toLowerCase();
  const noun = NOUNS[tag] ?? (element.rect.height > 240 ? "area" : "part");
  const styles = readStyles(element);
  const fontSize = Number.parseFloat(styles.get("font-size") ?? "");
  const big =
    (Number.isFinite(fontSize) && fontSize >= (tag === "h1" ? 40 : 28)) ||
    (noun === "picture" || noun === "area" ? element.rect.height >= 300 : false);
  const small = Number.isFinite(fontSize) && fontSize > 0 && fontSize <= 12;
  // A box or picture is known by its fill; words by their own colour, unless that is plain black.
  const fill = parseColor(styles.get("background-color") ?? styles.get("background") ?? "");
  const ink = parseColor(styles.get("color") ?? "");
  const textLike = !["button", "area", "part", "list item", "top part", "bottom part"].includes(
    noun,
  );
  const colorSource = textLike ? (ink ?? fill) : (fill ?? ink);
  const color = colorSource === null ? null : colorName(colorSource);
  const shade = color === "black" && textLike ? null : color;
  const words = [big ? "big" : small ? "small" : null, shade, noun].filter(Boolean).join(" ");
  const quote = noun === "picture" || noun === "drawing" ? "" : visibleText(element.htmlPreview);
  const said = quote.length === 0 ? "" : ` “${shortQuote(quote)}”`;
  return `the ${words}${said}`;
}

/** The engine-bound half of a chip: what the message tells the assistant. */
export function pointerFor(element: PickedElement): Pointer {
  return {
    label: describePickedElement(element),
    pageUrl: element.pageUrl,
    tagName: element.tagName.toLowerCase(),
    selector: element.selector,
    html: element.htmlPreview,
  };
}

/**
 * The yes a click on the preview may carry to the engine: only the "Start the preview?" card's,
 * for the command it showed. A failed start has none: "Try again" clears it and asks again like a
 * first start (the start command may have changed since, for example after the assistant fixed
 * it), and a start that needs no question goes ahead by itself.
 */
export function startApproval(
  status: PreviewStatusView | null,
): { readonly approved: true; readonly requestId: string } | null {
  return status?.state === "ready" && status.decision.kind !== "start"
    ? { approved: true, requestId: status.requestId }
    : null;
}
