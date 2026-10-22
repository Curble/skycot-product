// "Open it": which file a finished turn made that can be shown, and the page as the preview
// frame runs it. The frame is sandboxed with no same-origin access (it cannot read SKYCOT's
// storage or cookies), and a Content-Security-Policy keeps it offline — the promise every
// starter prompt makes ("no internet") is then also what the preview enforces.

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

/** The page with the offline policy and storage shim as the first things in its head. */
export function offlinePreviewDocument(html: string): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_POLICY}">${STORAGE_SHIM}`;
  const headTag = /<head(\s[^>]*)?>/i.exec(html);
  if (headTag) {
    const at = headTag.index + headTag[0].length;
    return `${html.slice(0, at)}${head}${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}${head}${html.slice(at)}`;
  }
  return `${head}${html}`;
}
