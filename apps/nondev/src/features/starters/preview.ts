// "Open it": which file a finished turn made that can be shown, where it is shown, and the page
// as the sealed frame runs it.
//
// Where: a real page is several files (style.css, rocket.js, three.module.js, pictures), and only
// a web server can give a page its own files the way a browser expects (`import` from a module
// most of all). So when the project's Preview shows plain pages (SKYCOT's own page server on
// 127.0.0.1: nothing of the project runs, no yes needed in any mode) and that page is inside what
// it shows, "Open it" opens the Preview at that page: exactly what the Preview button shows.
// Otherwise (a site with its own start command, a page outside the shown folder, no index.html,
// a phone, an engine that did not answer) the page opens in the sealed frame, with its own
// styles, scripts and pictures put inside it.
//
// The sealed frame is sandboxed with no same-origin access (it cannot read SKYCOT's storage or
// cookies), and a Content-Security-Policy keeps it offline: the promise every starter prompt
// makes ("no internet") is then also what it enforces.
import { BLOCKED_REPORTER, cleanSites, withHeadStart } from "@t3tools/skycot-rules/page-internet";

import type { PreviewStatusView } from "../preview/model";

export interface ChangedFileLike {
  readonly path: string;
  readonly operation: "added" | "edited" | "deleted" | "renamed";
}

/** The page to open: a new .html file first, then a changed one, `index.html` preferred. */
export function previewablePage(files: ReadonlyArray<ChangedFileLike>): string | null {
  const pages = files.filter((file) => file.operation !== "deleted" && /\.html?$/i.test(file.path));
  const rank = (file: ChangedFileLike) =>
    (file.operation === "added" ? 0 : 10) + (/(^|\/)index\.html?$/i.test(file.path) ? 0 : 1);
  return [...pages].sort((a, b) => rank(a) - rank(b))[0]?.path ?? null;
}

export type OpenItChoice =
  /** The project's Preview, at this address path inside the site ("/", "/games/rocket.html"). */
  | { readonly kind: "preview"; readonly path: string }
  /** The sealed, offline frame inside SKYCOT. */
  | { readonly kind: "sealed" };

const SEALED: OpenItChoice = { kind: "sealed" };

/**
 * The page's address inside the plain-page site that shows `folder`, or null when the site does
 * not show it: outside the folder, a way out of it (`..`), or a hidden name the page server
 * refuses (`.cache/x.html`).
 */
export function pathInPageSite(page: string, folder: string): string | null {
  const parts = page
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  const base = folder.split("/").filter((part) => part !== "" && part !== ".");
  if (page.startsWith("/") || parts.some((part) => part === ".." || part.startsWith("."))) {
    return null;
  }
  if (base.some((part, index) => parts[index] !== part)) return null;
  const inside = parts.slice(base.length);
  if (inside.length === 0 || !/\.html?$/i.test(inside.at(-1)!)) return null;
  if (inside.length === 1 && /^index\.html$/i.test(inside[0]!)) return "/";
  return `/${inside.map(encodeURIComponent).join("/")}`;
}

/**
 * Where "Open it" shows `page` (project-relative), from the engine's answer about this
 * conversation's Preview. `canShowPreviewHere`: the Preview's address works on this device (the
 * Mac app, or a browser on the Mac); a phone's sealed frame reads the page through the engine.
 */
export function openItChoice(input: {
  readonly page: string;
  readonly status: PreviewStatusView | null;
  readonly canShowPreviewHere: boolean;
}): OpenItChoice {
  const { status } = input;
  if (!input.canShowPreviewHere || status === null) return SEALED;
  if (status.state === "no-folder" || status.state === "no-site" || status.state === "failed") {
    return SEALED;
  }
  // A site with its own start command decides its own addresses (and starting it may need a
  // yes): a changed page is not known to be at any one of them.
  const { command } = status;
  if (!command.page || command.pageFolder === undefined) return SEALED;
  // A plain page never needs a yes; anything else here would be a question "Open it" never asks.
  if (status.state === "ready" && status.decision.kind !== "start") return SEALED;
  const path = pathInPageSite(input.page, command.pageFolder);
  return path === null ? SEALED : { kind: "preview", path };
}

/** The Preview's address for one page of the running site, on the site's own origin only. */
export function previewPageUrl(siteUrl: string, path: string | null): string {
  if (path === null) return siteUrl;
  try {
    const site = new URL(siteUrl);
    const page = new URL(path, site);
    return page.origin === site.origin ? page.href : siteUrl;
  } catch {
    return siteUrl;
  }
}

/** A page with a module script: its `import`s need a web server, which the sealed frame is not. */
export function usesModules(html: string): boolean {
  return /<script\b[^>]*\btype\s*=\s*["']?module\b/i.test(html);
}

export const PREVIEW_SANDBOX = "allow-scripts allow-modals allow-forms";

export const OFFLINE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

// An opaque-origin frame has no localStorage: a game that saves its high score would throw.
// This gives it an in-memory one that lasts while the preview is open.
const STORAGE_SHIM =
  "<script>(function(){try{window.localStorage.length}catch(e){var m=new Map();var s={getItem:function(k){return m.has(String(k))?m.get(String(k)):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()},key:function(i){return Array.from(m.keys())[i]||null},get length(){return m.size}};try{Object.defineProperty(window,'localStorage',{value:s,configurable:true});Object.defineProperty(window,'sessionStorage',{value:s,configurable:true})}catch(_){}}})()</script>";

/**
 * The sealed frame's policy: offline, except pictures, sounds, fonts and data from the sites a
 * grown-up allowed for this page (Family profile; https only, never scripts).
 */
export function sealedPolicy(sites: ReadonlyArray<string> = []): string {
  const allowed = cleanSites(sites)
    .flatMap((site) => [`https://${site}`, `https://*.${site}`])
    .join(" ");
  if (allowed === "") return OFFLINE_POLICY;
  return OFFLINE_POLICY.replace("img-src data: blob:", `img-src data: blob: ${allowed}`)
    .replace("font-src data:", `font-src data: ${allowed}`)
    .replace("media-src data: blob:", `media-src data: blob: ${allowed}`)
    .replace("connect-src 'none'", `connect-src ${allowed}`);
}

/**
 * The page with the policy, storage shim and blocked-address reporter as the first things in
 * its head. The reporter only tells SKYCOT's window which address the policy stopped.
 */
export function offlinePreviewDocument(html: string, sites: ReadonlyArray<string> = []): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${sealedPolicy(sites)}">${STORAGE_SHIM}${BLOCKED_REPORTER}`;
  return withHeadStart(html, head);
}
