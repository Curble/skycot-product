// Browsing a project's files, shared by the engine (which enforces it) and the plain client
// (which explains it): what kind of file something is in plain words, how Quick Look shows it,
// which entries are noise a child never needs (installed add-ons, build output, hidden and
// secret files), and the one shape of path the Files routes accept. Pure string logic.

export type FileKind =
  | "folder"
  | "page"
  | "picture"
  | "style"
  | "document"
  | "code"
  | "sound"
  | "video"
  | "other";

/** How Quick Look shows a file; `none` is "SKYCOT can't show this kind of file". */
export type QuickLookMode = "picture" | "page" | "pdf" | "text" | "markdown" | "media" | "none";

const PAGE = new Set(["html", "htm"]);
const PICTURE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const STYLE = new Set(["css", "scss", "sass", "less"]);
const PDF = new Set(["pdf"]);
const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const PLAIN_TEXT = new Set(["txt", "text", "csv", "tsv", "log"]);
/** Documents Quick Look cannot open (word processors, spreadsheets, slides). */
const OTHER_DOCUMENT = new Set([
  "rtf",
  "doc",
  "docx",
  "pages",
  "odt",
  "xls",
  "xlsx",
  "numbers",
  "ppt",
  "pptx",
  "key",
  "epub",
]);
const CODE = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "json",
  "jsonc",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "lua",
  "sh",
  "bash",
  "zsh",
  "vue",
  "svelte",
  "astro",
  "yml",
  "yaml",
  "toml",
  "ini",
  "xml",
  "sql",
  "graphql",
  "gd",
]);
const SOUND = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
/** Files with no extension that are plain text all the same. */
const TEXT_NAMES = new Set([
  "readme",
  "license",
  "licence",
  "changelog",
  "makefile",
  "dockerfile",
  "procfile",
  "gemfile",
]);

function extensionOf(name: string): string {
  const base = name.split("/").at(-1) ?? name;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function baseName(name: string): string {
  return (name.split("/").at(-1) ?? name).toLowerCase();
}

/** The kind a person would call it. */
export function fileKindOf(name: string, isFolder = false): FileKind {
  if (isFolder) return "folder";
  const extension = extensionOf(name);
  if (PAGE.has(extension)) return "page";
  if (PICTURE.has(extension)) return "picture";
  if (STYLE.has(extension)) return "style";
  if (
    PDF.has(extension) ||
    MARKDOWN.has(extension) ||
    PLAIN_TEXT.has(extension) ||
    OTHER_DOCUMENT.has(extension)
  ) {
    return "document";
  }
  if (CODE.has(extension)) return "code";
  if (SOUND.has(extension)) return "sound";
  if (VIDEO.has(extension)) return "video";
  if (extension === "" && TEXT_NAMES.has(baseName(name))) return "document";
  return "other";
}

export const FILE_KIND_LABEL: Readonly<Record<FileKind, string>> = {
  folder: "Folder",
  page: "Page",
  picture: "Picture",
  style: "Style",
  document: "Document",
  code: "Code",
  sound: "Sound",
  video: "Video",
  other: "File",
};

/** How Quick Look shows the file. The engine reads the same answer to pick what it sends. */
export function quickLookModeOf(name: string): QuickLookMode {
  const extension = extensionOf(name);
  if (PAGE.has(extension)) return "page";
  if (PICTURE.has(extension)) return "picture";
  if (PDF.has(extension)) return "pdf";
  if (MARKDOWN.has(extension)) return "markdown";
  if (SOUND.has(extension) || VIDEO.has(extension)) return "media";
  if (PLAIN_TEXT.has(extension) || STYLE.has(extension) || CODE.has(extension)) return "text";
  if (extension === "" && TEXT_NAMES.has(baseName(name))) return "text";
  // Dotfiles (`.gitignore`, `.env`) are text; the engine decides whether a child may see them.
  if (extension === "" && baseName(name).startsWith(".")) return "text";
  return "none";
}

const MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
};

/** The media type the client builds its picture, PDF or sound from. */
export function mimeTypeOf(name: string): string {
  return MIME[extensionOf(name)] ?? "text/plain";
}

/** Folders a person never needs to look in: installed add-ons, build output, caches. */
const NOISE_FOLDERS = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "__pycache__",
  "venv",
  "env",
  "vendor",
]);
/** System litter. */
const NOISE_FILES = new Set(["thumbs.db", "desktop.ini", "npm-debug.log", "yarn-error.log"]);
/** Keys and certificates: secrets whatever the folder. */
const SECRET_FILE = /\.(pem|key|p12|pfx|keystore|jks)$/i;

/**
 * Whether one name is noise: hidden (a dotfile or dot-folder, which covers `.git`, `.env`,
 * `.next` and `.DS_Store`), an add-ons or build folder, system litter, or a key file.
 */
export function isNoiseName(name: string, isFolder: boolean): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".")) return true;
  if (isFolder) return NOISE_FOLDERS.has(lower);
  if (NOISE_FILES.has(lower)) return true;
  // A `.key` file is a Keynote deck as often as a key; both stay behind Show everything.
  return SECRET_FILE.test(lower);
}

/** Whether any part of a project path is noise (every part but the last is a folder). */
export function pathHasNoise(relativePath: string, isFolder: boolean): boolean {
  const parts = relativePath.split("/").filter((part) => part.length > 0);
  return parts.some((part, index) => isNoiseName(part, index < parts.length - 1 ? true : isFolder));
}

/**
 * Whether a path is or goes through a hidden or secret file (`.env`, `.git/…`, a key). The
 * engine holds these for a grown-up wherever a file is read, not only in the Files view.
 */
export function pathIsHiddenOrSecret(relativePath: string): boolean {
  const parts = relativePath.split("/").filter((part) => part.length > 0);
  return parts.some(
    (part, index) => part.startsWith(".") || (index === parts.length - 1 && SECRET_FILE.test(part)),
  );
}

export const MAX_BROWSE_PATH_LENGTH = 1024;

/**
 * The only path shape the Files routes accept: relative to the project, forward slashes,
 * no `.` or `..` parts, no leading `/` or `~`, no drive letter, no control characters.
 * "" is the project folder itself. Null means refused. Symlinks are the engine's business:
 * it resolves the real path and refuses anything that lands outside the project.
 */
export function cleanBrowsePath(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_BROWSE_PATH_LENGTH) return null;
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  if (raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}
