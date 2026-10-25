import { registrableDomain } from "./publicSuffix.ts";

// "A grown-up says yes once per page before it can load things from the internet" (Mark,
// 25 Oct 2026). While the Family profile is on, a child's page runs offline: SKYCOT's own page
// server and the sealed frame both give it a Content-Security-Policy with no internet sites.
// When a grown-up says yes (the parent code, once), that page (one file on this Mac) may load
// pictures, sounds, fonts and data from the sites they allowed, over https only. Scripts,
// frames and forms never reach the internet: add-ons come through SKYCOT's own installs.
//
// A site is the address a grown-up recognises ("dog.ceo"), and it covers its own sub-addresses
// ("images.dog.ceo"): a picture service often answers from one and serves from another, and
// asking twice for one page would teach families to say yes without reading.

/** At most this many sites per page; a page wanting more is not a child's page. */
export const MAX_PAGE_SITES = 8;
/** At most this many allowed pages are kept (the oldest go first). */
export const MAX_PAGE_ENTRIES = 200;

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/u;

/**
 * The registrable domain a grown-up is asked about, including private hosting suffixes; null
 * for anything that is not a public name (an IP address, localhost, a single word or public suffix).
 */
export function siteOf(host: string): string | null {
  // Page hosts arrive here as labels, not URL parser output. Reject non-canonical spellings
  // rather than silently turning malformed input into an approval for a different site.
  if (host !== host.trim() || host !== host.toLowerCase() || host.endsWith(".")) return null;
  const name = host;
  if (!HOST.test(name) || name.endsWith(".localhost") || name.endsWith(".local")) return null;
  if (name.split(".").some((label) => label.startsWith("xn--"))) return null;
  return registrableDomain(name);
}

// Plain text, not URL: these rules also run on the phone, which has no URL parser to rely on.
const WEB_ADDRESS = /^(https?):\/\/(?:[^@/?#]*@)?([^:/?#]*)(?::\d+)?([^?#]*)/iu;

/** The site of an address the page tried, when it is https or http; null otherwise. */
export function siteOfUrl(url: string): string | null {
  const match = WEB_ADDRESS.exec(url.trim());
  return match === null ? null : siteOf(match[2]!);
}

// nondev-seam: skycot-page-play-policy
/** A site named by the sealed page's reporter, when it is a public https address. */
export function reportedSite(data: unknown): string | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (
    message["skycot"] !== "page-internet" ||
    typeof message["url"] !== "string" ||
    typeof message["directive"] !== "string" ||
    Object.keys(message).length !== 3 ||
    !message["url"].startsWith("https://")
  )
    return null;
  return siteOfUrl(message["url"]);
}

/** Sites as stored and sent: public names only, each once, sorted, at most MAX_PAGE_SITES. */
export function cleanSites(sites: ReadonlyArray<unknown>): ReadonlyArray<string> {
  const clean = new Set<string>();
  for (const site of sites) {
    if (typeof site !== "string") continue;
    const name = siteOf(site);
    if (name !== null) clean.add(name);
  }
  return [...clean].sort().slice(0, MAX_PAGE_SITES);
}

/** A page is one file on this Mac: an absolute path to an .html file, with no way out. */
export function cleanPagePath(page: unknown): string | null {
  if (typeof page !== "string" || page.length > 1024 || !page.startsWith("/")) return null;
  if (!/\.html?$/iu.test(page) || page.includes("\0")) return null;
  const parts = page.split("/");
  if (parts.some((part) => part === ".." || part === ".")) return null;
  return parts.filter((part, index) => index === 0 || part !== "").join("/");
}

/** What each allowed site adds to a page's policy: the site and its sub-addresses, https only. */
function sources(sites: ReadonlyArray<string>): string {
  return cleanSites(sites)
    .flatMap((site) => [`https://${site}`, `https://*.${site}`])
    .join(" ");
}

function withSites(base: string, sites: ReadonlyArray<string>): string {
  const extra = sources(sites);
  return extra === "" ? base : `${base} ${extra}`;
}

/** Where a browser reports what the policy stopped, on SKYCOT's own page server. */
export const BLOCKED_REPORT_PATH = "/.skycot/blocked";

/**
 * The policy SKYCOT's page server sends with a child's page: its own files ('self') as before,
 * and the internet only for the allowed sites' pictures, sounds, fonts and data. The browser
 * reports each stopped address to the page server, so SKYCOT can ask a grown-up.
 */
export function pageServerPolicy(sites: ReadonlyArray<string>): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    withSites("img-src 'self' data: blob:", sites),
    withSites("media-src 'self' data: blob:", sites),
    withSites("font-src 'self' data:", sites),
    withSites("connect-src 'self'", sites),
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "form-action 'none'",
    "base-uri 'self'",
    `report-uri ${BLOCKED_REPORT_PATH}`,
  ].join("; ");
}

/**
 * Reads a browser's report of a stopped address (`application/csp-report`): the page's own
 * address path and the site it tried. Null for anything else, or a site that is not public.
 */
export function readBlockedReport(
  body: string,
): { readonly pagePath: string; readonly site: string } | null {
  let report: unknown;
  try {
    report = (JSON.parse(body) as Record<string, unknown>)["csp-report"];
  } catch {
    return null;
  }
  if (typeof report !== "object" || report === null) return null;
  const fields = report as Record<string, unknown>;
  const documentUri = fields["document-uri"];
  const blockedUri = fields["blocked-uri"];
  if (typeof documentUri !== "string" || typeof blockedUri !== "string") return null;
  // Only the internet over https can be allowed; an http:// address stays stopped.
  if (!blockedUri.startsWith("https://")) return null;
  const site = siteOfUrl(blockedUri);
  if (site === null) return null;
  const page = WEB_ADDRESS.exec(documentUri.trim());
  return page === null ? null : { pagePath: page[3] || "/", site };
}

/**
 * A few lines put at the top of a child's page: when the page tries an internet address the
 * policy stops, SKYCOT's window is told which one (only the address, nothing of the page), so
 * it can offer "Get a grown-up".
 */
export const BLOCKED_REPORTER =
  "<script>(function(){document.addEventListener('securitypolicyviolation',function(e){try{var u=new URL(e.blockedURI);if(u.protocol!=='https:'&&u.protocol!=='http:')return;var m={skycot:'page-internet',url:u.origin,directive:String(e.effectiveDirective||'')};if(window.ReactNativeWebView&&typeof window.ReactNativeWebView.postMessage==='function')window.ReactNativeWebView.postMessage(JSON.stringify(m));else window.parent.postMessage(m,'*')}catch(_){}})})()</script>";

// nondev-seam: skycot-page-play-policy
/** Policy for a page's own runnable copy: local code only, and allowed sites for data only. */
export const OFFLINE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data: blob:",
  "media-src data: blob:",
  "connect-src blob: data:",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

// nondev-seam: skycot-page-play-policy
export const STORAGE_SHIM =
  "<script>(function(){try{window.localStorage.length}catch(e){var m=new Map();var s={getItem:function(k){return m.has(String(k))?m.get(String(k)):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()},key:function(i){return Array.from(m.keys())[i]||null},get length(){return m.size}};try{Object.defineProperty(window,'localStorage',{value:s,configurable:true});Object.defineProperty(window,'sessionStorage',{value:s,configurable:true})}catch(_){}}})()</script>";

// nondev-seam: skycot-page-play-policy
export function sealedPolicy(sites: ReadonlyArray<string> = []): string {
  const allowed = cleanSites(sites)
    .flatMap((site) => [`https://${site}`, `https://*.${site}`])
    .join(" ");
  if (allowed === "") return OFFLINE_POLICY;
  return OFFLINE_POLICY.replace("img-src data: blob:", `img-src data: blob: ${allowed}`)
    .replace("font-src data: blob:", `font-src data: blob: ${allowed}`)
    .replace("media-src data: blob:", `media-src data: blob: ${allowed}`)
    .replace("connect-src blob: data:", `connect-src blob: data: ${allowed}`);
}

/** The page with `head` put first inside its <head> (or after the doctype, or at the start). */
export function withHeadStart(html: string, head: string): string {
  const headTag = /<head(\s[^>]*)?>/iu.exec(html);
  if (headTag) {
    const at = headTag.index + headTag[0].length;
    return `${html.slice(0, at)}${head}${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/iu.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}${head}${html.slice(at)}`;
  }
  return `${head}${html}`;
}

export interface PageInternetEntry {
  readonly page: string;
  readonly sites: ReadonlyArray<string>;
  readonly at: number;
}

/** The allowed sites for one page; an empty list when nothing was allowed. */
export function sitesForPage(
  entries: ReadonlyArray<PageInternetEntry>,
  page: string,
): ReadonlyArray<string> {
  const clean = cleanPagePath(page);
  if (clean === null) return [];
  return cleanSites(entries.find((entry) => entry.page === clean)?.sites ?? []);
}

/** The entries after a grown-up allowed `sites` for `page`: added to what it had, newest last. */
export function withAllowed(
  entries: ReadonlyArray<PageInternetEntry>,
  page: string,
  sites: ReadonlyArray<string>,
  at: number,
): ReadonlyArray<PageInternetEntry> {
  const before = sitesForPage(entries, page);
  const others = entries.filter((entry) => entry.page !== page);
  const next = { page, sites: cleanSites([...before, ...sites]), at };
  return [...others, next].slice(-MAX_PAGE_ENTRIES);
}
