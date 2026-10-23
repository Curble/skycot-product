// Files and Quick Look, pure part: the engine's answers as this client reads them, the words
// a row shows ("Picture · 24 KB · changed 5 minutes ago"), the order and the noise filter, and
// how a page's own pictures, styles and scripts are put inside it so the offline frame shows
// it as it looks (the frame can't fetch anything, by design).
import {
  FILE_KIND_LABEL,
  fileKindOf,
  type FileKind,
  type QuickLookMode,
} from "@t3tools/skycot-rules/browse";

export interface FilesEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "folder" | "file";
  readonly size: number | null;
  readonly modifiedAt: number | null;
  readonly noise: boolean;
}

export interface FilesListing {
  readonly root: string;
  readonly privateCopy: boolean;
  readonly path: string;
  readonly entries: ReadonlyArray<FilesEntry>;
  readonly hiddenCount: number;
  readonly noiseIncluded: boolean;
  readonly truncated: boolean;
}

export interface FileRead {
  readonly name: string;
  readonly path: string;
  readonly mode: QuickLookMode;
  readonly mimeType: string;
  readonly size: number;
  readonly modifiedAt: number | null;
  readonly encoding: "utf8" | "base64" | null;
  readonly contents: string | null;
  readonly truncated: boolean;
  readonly tooBig: boolean;
  readonly absolutePath: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function parseEntry(value: unknown): FilesEntry | null {
  const entry = record(value);
  if (entry === null) return null;
  const { name, path, kind } = entry;
  if (typeof name !== "string" || typeof path !== "string") return null;
  if (kind !== "folder" && kind !== "file") return null;
  return {
    name,
    path,
    kind,
    size: numberOrNull(entry["size"]),
    modifiedAt: numberOrNull(entry["modifiedAt"]),
    noise: entry["noise"] === true,
  };
}

export function parseListing(body: unknown): FilesListing | null {
  const listing = record(body);
  if (listing === null || !Array.isArray(listing["entries"])) return null;
  if (typeof listing["root"] !== "string" || typeof listing["path"] !== "string") return null;
  return {
    root: listing["root"],
    privateCopy: listing["privateCopy"] === true,
    path: listing["path"],
    entries: listing["entries"].flatMap((entry: unknown) => {
      const parsed = parseEntry(entry);
      return parsed === null ? [] : [parsed];
    }),
    hiddenCount: numberOrNull(listing["hiddenCount"]) ?? 0,
    noiseIncluded: listing["noiseIncluded"] === true,
    truncated: listing["truncated"] === true,
  };
}

const MODES: ReadonlySet<string> = new Set<QuickLookMode>([
  "picture",
  "page",
  "pdf",
  "text",
  "markdown",
  "media",
  "none",
]);

export function parseFileRead(body: unknown): FileRead | null {
  const file = record(body);
  if (file === null) return null;
  const { name, path, mode, mimeType, absolutePath } = file;
  if (typeof name !== "string" || typeof path !== "string" || typeof absolutePath !== "string") {
    return null;
  }
  if (typeof mode !== "string" || !MODES.has(mode) || typeof mimeType !== "string") return null;
  const encoding = file["encoding"];
  return {
    name,
    path,
    mode: mode as QuickLookMode,
    mimeType,
    size: numberOrNull(file["size"]) ?? 0,
    modifiedAt: numberOrNull(file["modifiedAt"]),
    encoding: encoding === "utf8" || encoding === "base64" ? encoding : null,
    contents: typeof file["contents"] === "string" ? file["contents"] : null,
    truncated: file["truncated"] === true,
    tooBig: file["tooBig"] === true,
    absolutePath,
  };
}

export function kindOfEntry(entry: Pick<FilesEntry, "name" | "kind">): FileKind {
  return fileKindOf(entry.name, entry.kind === "folder");
}

/** Finder's sizes: powers of 1000, one decimal under 10. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "Zero bytes";
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${shown} ${units[unit]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "changed just now", "changed 5 minutes ago", "changed yesterday", "changed 3 Oct". */
export function changedAgo(at: number | null, now: number): string | null {
  if (at === null) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "changed just now";
  if (minutes < 60)
    return minutes === 1 ? "changed 1 minute ago" : `changed ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  const then = new Date(at);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (hours < 24 && at >= midnight) {
    return hours === 1 ? "changed 1 hour ago" : `changed ${hours} hours ago`;
  }
  if (at >= midnight - 86_400_000) return "changed yesterday";
  const days = Math.floor((midnight - at) / 86_400_000) + 1;
  if (days < 7) return `changed ${days} days ago`;
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === today.getFullYear()
    ? `changed ${date}`
    : `changed ${date} ${then.getFullYear()}`;
}

/** The row's second line: "Picture · 24 KB · changed 5 minutes ago". */
export function entryDetails(entry: FilesEntry, now: number): string {
  const parts: Array<string> = [FILE_KIND_LABEL[kindOfEntry(entry)]];
  if (entry.kind === "file" && entry.size !== null) parts.push(formatSize(entry.size));
  const changed = changedAgo(entry.modifiedAt, now);
  if (changed !== null) parts.push(changed);
  return parts.join(" · ");
}

/**
 * What the list shows: noise only when Show everything is on, then the search (by name, any
 * case), folders first and names in the order Finder uses ("page 2" before "page 10").
 */
export function visibleEntries(
  entries: ReadonlyArray<FilesEntry>,
  options: { readonly showEverything: boolean; readonly search: string },
): Array<FilesEntry> {
  const query = options.search.trim().toLowerCase();
  return entries
    .filter((entry) => options.showEverything || !entry.noise)
    .filter((entry) => query.length === 0 || entry.name.toLowerCase().includes(query))
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
}

/** How many entries Show everything would add here (the engine's held ones included). */
export function hiddenHere(listing: FilesListing): number {
  return listing.hiddenCount + listing.entries.filter((entry) => entry.noise).length;
}

/** The folders from the project down to `path`, for the path bar. */
export function crumbsOf(
  path: string,
  projectTitle: string,
): Array<{ readonly label: string; readonly path: string }> {
  const parts = path.split("/").filter((part) => part.length > 0);
  return [
    { label: projectTitle, path: "" },
    ...parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join("/") })),
  ];
}

export function parentOf(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.slice(0, -1).join("/");
}

/** Quick Look's note under the code: kind words, never jargon. */
export function codeNote(name: string): string | null {
  const kind = fileKindOf(name);
  if (kind === "style") return "This is the code behind your page: it says how things look.";
  if (kind === "code") return "This is the code behind your page: it says what things do.";
  return null;
}

// A page's own files, put inside it: the offline frame cannot fetch them.

export type PageAssetKind = "style" | "script" | "picture";

export interface PageAssetRef {
  readonly kind: PageAssetKind;
  /** As written in the page. */
  readonly ref: string;
  /** Project-relative. */
  readonly path: string;
}

/** At most this many files are put inside one page. */
export const MAX_PAGE_ASSETS = 24;

/**
 * A reference in a page as a project path: relative to the page's folder, `..` allowed while it
 * stays inside the project, no web addresses, no `/`-rooted paths (they mean the site's root,
 * which a file on disk does not have).
 */
export function resolvePageRef(pagePath: string, ref: string): string | null {
  const bare = ref.trim().split(/[?#]/, 1)[0] ?? "";
  if (bare.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const parts = pagePath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length === 0 ? null : parts.join("/");
}

const LINK_TAG = /<link\b[^>]*>/gi;
const SCRIPT_TAG = /<script\b([^>]*)>\s*<\/script\s*>/gi;
const IMG_TAG = /<img\b[^>]*>/gi;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? null);
}

function isStylesheet(tag: string): boolean {
  return /(^|\s)stylesheet(\s|$)/i.test(attribute(tag, "rel") ?? "");
}

/** The page's own styles, scripts and pictures, in order, each once. */
export function pageAssetRefs(pagePath: string, html: string): Array<PageAssetRef> {
  const found: Array<PageAssetRef> = [];
  const seen = new Set<string>();
  const add = (kind: PageAssetKind, ref: string | null) => {
    if (ref === null) return;
    const path = resolvePageRef(pagePath, ref);
    if (path === null || seen.has(`${kind}:${path}`) || found.length >= MAX_PAGE_ASSETS) return;
    seen.add(`${kind}:${path}`);
    found.push({ kind, ref, path });
  };
  for (const tag of html.match(LINK_TAG) ?? []) {
    if (isStylesheet(tag)) add("style", attribute(tag, "href"));
  }
  for (const match of html.matchAll(SCRIPT_TAG)) add("script", attribute(match[0], "src"));
  for (const tag of html.match(IMG_TAG) ?? []) add("picture", attribute(tag, "src"));
  return found;
}

/** What each asset became: text for styles and scripts, a data address for pictures. */
export type PageAssets = ReadonlyMap<string, string>;

const assetKey = (kind: PageAssetKind, path: string) => `${kind}:${path}`;

export function pageAssetKey(asset: Pick<PageAssetRef, "kind" | "path">): string {
  return assetKey(asset.kind, asset.path);
}

/**
 * The page with its own files inside it. A file that could not be read keeps its tag as
 * written: the offline frame then simply shows the page without it.
 */
export function inlinePageAssets(pagePath: string, html: string, assets: PageAssets): string {
  const lookup = (kind: PageAssetKind, ref: string | null) => {
    if (ref === null) return null;
    const path = resolvePageRef(pagePath, ref);
    return path === null ? null : (assets.get(assetKey(kind, path)) ?? null);
  };
  return html
    .replace(LINK_TAG, (tag) => {
      if (!isStylesheet(tag)) return tag;
      const css = lookup("style", attribute(tag, "href"));
      return css === null ? tag : `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
    })
    .replace(SCRIPT_TAG, (tag, attributes: string) => {
      const code = lookup("script", attribute(tag, "src"));
      if (code === null) return tag;
      const kept = attributes.replace(
        /\s(src|integrity|crossorigin)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
        "",
      );
      return `<script${kept}>${code.replace(/<\/script/gi, "<\\/script")}</script>`;
    })
    .replace(IMG_TAG, (tag) => {
      const ref = attribute(tag, "src");
      const data = lookup("picture", ref);
      if (data === null) return tag;
      return tag.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ` src="${data}"`);
    });
}
