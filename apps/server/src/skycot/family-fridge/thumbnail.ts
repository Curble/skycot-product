// A made page as one self-contained document, for the fridge's thumbnail frame.
//
// The thumbnail is drawn from `srcdoc` in a frame with no scripts and no network
// (apps/nondev features/fridge/MagnetThumb: `sandbox=""` plus the offline policy). A relative
// `style.css` there resolves against SKYCOT's own address, so the policy blocked it and the page
// showed unstyled with console errors. Rather than open the frame to any address, the engine
// reads the page's own files and puts them inside it: relative stylesheets become `<style>`,
// relative pictures and fonts become `data:` addresses. Everything else that would make the frame
// ask for something (scripts, which never run there anyway, other links, frames, srcset, `<base>`,
// any address on the internet) is left out, so the frame asks for nothing at all.
//
// Only files inside the project are read (`..` and links out of it are refused by the reader),
// with size caps, so a big page cannot make the fridge slow.
//
// The same copy is what a child's phone or iPad shows for "Open it" (apps/skycot-mobile
// PagePreview), so it carries no code at all: no scripts, no code in tags (`onload="…"`), no
// `javascript:` links, no automatic redirects, and offline rules of its own that forbid code
// and the internet even if something slipped through (the Family decision of 25 Oct 2026: a
// page reaches the internet only after a grown-up's yes, which the copy never has).

import * as Effect from "effect/Effect";

import { withHeadStart } from "@t3tools/skycot-rules/page-internet";

/** Reads one project file by its project-relative path; null when it is missing or refused. */
export type ReadProjectFile = (relativePath: string) => Effect.Effect<Uint8Array | null>;

export const MAX_PAGE_BYTES = 1_000_000;
export const MAX_ASSET_BYTES = 2_000_000;
export const MAX_TOTAL_BYTES = 8_000_000;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

const decoder = new TextDecoder();

/** The copy's own rules: its inlined styles, pictures, fonts and sounds; no code, no internet. */
export const PAGE_COPY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** A tag, quotes respected: `<a title="1 > 0">` is one tag. */
const TAG = /<[a-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
/** One attribute and its value, as written (a browser also takes "/" between attributes). */
const ATTRIBUTE = /[\s/]([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/gu;

/** An attribute value as a browser reads it for its scheme: entities decoded, spaces gone. */
function schemeOf(value: string): string {
  const code = (point: number) => (point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd");
  return value
    .replace(/^["']|["']$/gu, "")
    .replace(/&#x([\da-f]+);?/giu, (_, hex: string) => code(parseInt(hex, 16)))
    .replace(/&#(\d+);?/gu, (_, decimal: string) => code(Number(decimal)))
    .replace(/&colon;/giu, ":")
    .replace(/&tab;|&newline;/giu, "")
    .replace(/[\u0000-\u0020]/gu, "")
    .toLowerCase();
}

/** The tag without code: every `on…` handler, and any address that is code (`javascript:`). */
function tagWithoutCode(tag: string): string {
  return tag.replace(ATTRIBUTE, (whole, name: string, value: string | undefined) => {
    if (/^on/iu.test(name)) return "";
    if (value !== undefined && /^(?:javascript|vbscript):/u.test(schemeOf(value))) return "";
    return whole;
  });
}

/** The page with no code left in it and its own offline rules first in the head. */
export function withoutCode(html: string): string {
  const cleaned = html
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/giu, "")
    .replace(TAG, tagWithoutCode);
  return withHeadStart(
    cleaned,
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_COPY_POLICY}">`,
  );
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/**
 * A reference written in the page as a project-relative path, or null for anything that is not
 * one: an address with a scheme (`https:`, `data:`, `javascript:`), `//host/…`, an empty or
 * fragment-only reference, or one that climbs out of the project.
 */
export function projectPathOf(fromDir: string, reference: string): string | null {
  const raw = reference.trim().replace(/[?#].*$/su, "");
  if (raw.length === 0 || /^[a-z][a-z\d+.-]*:/iu.test(raw) || raw.startsWith("//")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts: Array<string> = [];
  const joined = decoded.startsWith("/") ? decoded : `${fromDir}/${decoded}`;
  for (const part of joined.split(/[/\\]/u)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length === 0 ? null : parts.join("/");
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag);
  return match === null ? null : (match[2] ?? match[3] ?? match[4] ?? "");
}

function withoutAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "giu"), "");
}

function withAttribute(tag: string, name: string, value: string): string {
  const stripped = withoutAttribute(tag, name);
  return stripped.replace(/\s*\/?>$/u, (end) => ` ${name}="${value}"${end}`);
}

const escapeAttribute = (value: string) => value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;");

/** Turns a project page and its own files into one document that needs nothing else. */
export const selfContainedPage = Effect.fn("SkycotFridge.selfContainedPage")(function* (
  page: string,
  read: ReadProjectFile,
) {
  const pageBytes = yield* read(page);
  if (pageBytes === null || pageBytes.byteLength > MAX_PAGE_BYTES) return null;
  let budget = MAX_TOTAL_BYTES;
  const cache = new Map<string, Uint8Array | null>();
  const take = Effect.fnUntraced(function* (path: string) {
    if (!cache.has(path)) cache.set(path, yield* read(path));
    const bytes = cache.get(path) ?? null;
    if (bytes === null || bytes.byteLength > MAX_ASSET_BYTES || bytes.byteLength > budget) {
      return null;
    }
    budget -= bytes.byteLength;
    return bytes;
  });

  const dataAddress = Effect.fnUntraced(function* (fromDir: string, reference: string) {
    const path = projectPathOf(fromDir, reference);
    if (path === null) return null;
    const mime = MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""];
    if (mime === undefined) return null;
    const bytes = yield* take(path);
    return bytes === null ? null : `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  });

  /** `url(…)` in CSS: the project's pictures and fonts inlined, anything else emptied. */
  const inlineCss = Effect.fnUntraced(function* (css: string, fromDir: string) {
    const withoutImports = css.replace(/@import\s+[^;]+;?/giu, "");
    let out = "";
    let last = 0;
    for (const match of withoutImports.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/giu)) {
      const reference = match[2] ?? "";
      const inlined = reference.startsWith("data:")
        ? reference
        : yield* dataAddress(fromDir, reference);
      out += `${withoutImports.slice(last, match.index)}url("${inlined ?? ""}")`;
      last = match.index + match[0].length;
    }
    return out + withoutImports.slice(last);
  });

  const pageDir = dirOf(page);
  let html = decoder
    .decode(pageBytes)
    // Never run in the thumbnail frame, so they only cost bytes (and an external one a request).
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, "")
    .replace(/<script\b[^>]*\/>/giu, "")
    .replace(/<base\b[^>]*>/giu, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe\s*>/giu, "");

  // Stylesheets the page links: inlined when they are the project's own, dropped otherwise.
  let out = "";
  let last = 0;
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0];
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/u);
    const href = attribute(tag, "href");
    let replacement = "";
    if (rel.includes("stylesheet") && href !== null) {
      const path = projectPathOf(pageDir, href);
      const bytes =
        path === null || !path.toLowerCase().endsWith(".css") ? null : yield* take(path);
      if (path !== null && bytes !== null) {
        const css = yield* inlineCss(decoder.decode(bytes), dirOf(path));
        replacement = `<style>${css.replace(/<\/style/giu, "<\\/style")}</style>`;
      }
    }
    out += html.slice(last, match.index) + replacement;
    last = match.index + match[0].length;
  }
  html = out + html.slice(last);

  // `<style>` blocks and `style="…"` attributes may point at pictures too.
  out = "";
  last = 0;
  for (const match of html.matchAll(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/giu)) {
    out += `${html.slice(last, match.index)}${match[1]}${yield* inlineCss(match[2] ?? "", pageDir)}${match[3]}`;
    last = match.index + match[0].length;
  }
  html = out + html.slice(last);

  // Pictures, video posters and sources: the project's own inlined, others emptied.
  out = "";
  last = 0;
  for (const match of html.matchAll(
    /<(img|source|video|audio|input|image|use|track|embed|object)\b[^>]*>/giu,
  )) {
    let tag = withoutAttribute(match[0], "srcset");
    for (const name of ["src", "poster", "data", "href", "xlink:href"]) {
      const value = attribute(tag, name);
      if (value === null || value.startsWith("data:") || value.startsWith("#")) continue;
      const inlined = yield* dataAddress(pageDir, value);
      tag = inlined === null ? withoutAttribute(tag, name) : withAttribute(tag, name, inlined);
    }
    const style = attribute(tag, "style");
    if (style !== null && /url\(/iu.test(style)) {
      tag = withAttribute(tag, "style", escapeAttribute(yield* inlineCss(style, pageDir)));
    }
    out += html.slice(last, match.index) + tag;
    last = match.index + match[0].length;
  }
  html = out + html.slice(last);

  // Any other element's `style="…url(…)"` (a background picture on a div).
  out = "";
  last = 0;
  for (const match of html.matchAll(
    /<[a-z][\w-]*\b[^>]*\sstyle\s*=\s*("[^"]*url\([^"]*"|'[^']*url\([^']*')[^>]*>/giu,
  )) {
    const style = attribute(match[0], "style") ?? "";
    const inlined = yield* inlineCss(style.replace(/&quot;/gu, '"'), pageDir);
    out +=
      html.slice(last, match.index) + withAttribute(match[0], "style", escapeAttribute(inlined));
    last = match.index + match[0].length;
  }
  return withoutCode(out + html.slice(last));
});
