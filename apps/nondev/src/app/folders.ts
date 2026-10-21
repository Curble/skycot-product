// Pure helpers for "Open a folder…": which folders may become a project, which
// entries to show, and how to spell a path for someone who has never seen one.
import type { FilesystemBrowseEntry } from "@t3tools/contracts";

export type FolderVerdict =
  | { readonly kind: "ok" }
  /** Allowed, but almost certainly too broad; the sheet says so before Open. */
  | { readonly kind: "warn"; readonly reason: string }
  /** Never a project: the sheet disables Open and says why. */
  | { readonly kind: "refuse"; readonly reason: string };

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;

function isWindowsPath(path: string): boolean {
  return WINDOWS_DRIVE.test(path);
}

/** `/Users/mark/Sites/` → `/Users/mark/Sites`; `/` stays `/`; `C:\` stays `C:\`. */
export function normalizeFolderPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/" || /^[a-zA-Z]:[\\/]$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

export function sameFolder(a: string, b: string): boolean {
  const left = normalizeFolderPath(a);
  const right = normalizeFolderPath(b);
  if (isWindowsPath(left) || isWindowsPath(right)) {
    return left.replace(/\//g, "\\").toLowerCase() === right.replace(/\//g, "\\").toLowerCase();
  }
  return left === right;
}

export function folderSegments(path: string): ReadonlyArray<string> {
  return normalizeFolderPath(path)
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
}

/**
 * The home folder a path sits under, when it is the shape every desktop OS
 * uses (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`). The engine does
 * not report the home directory, but its working folder is always under it.
 */
export function homeDirectoryFrom(path: string): string | null {
  const segments = folderSegments(path);
  if (segments.length < 2) return null;
  if (isWindowsPath(path)) {
    if (segments[1]?.toLowerCase() !== "users" || segments.length < 3) return null;
    return `${segments[0]}\\Users\\${segments[2]}`;
  }
  if ((segments[0] === "Users" || segments[0] === "home") && segments[1] !== "Shared") {
    return `/${segments[0]}/${segments[1]}`;
  }
  return null;
}

const SYSTEM_ROOTS_POSIX = [
  "/Applications",
  "/Library",
  "/System",
  "/private",
  "/var",
  "/etc",
  "/opt",
  "/usr",
  "/bin",
  "/sbin",
  "/tmp",
  "/dev",
  "/cores",
  "/root",
  "/boot",
  "/proc",
  "/sys",
  "/lib",
  "/lib64",
  "/snap",
  "/srv",
];

const SYSTEM_REASON =
  "This is part of your Mac's system, not a project. Pick the folder that holds just this website or app.";
const HOME_REASON =
  "This is your whole home folder: your mail, passwords, photos and every file you own. Pick the folder that holds just this website or app.";
const USERS_REASON =
  "This folder holds every account on this Mac. Pick the folder that holds just this website or app.";
const ROOT_REASON =
  "This is the whole disk, not a project. Pick the folder that holds just this website or app.";

const BROAD_HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Movies"];

function startsWithFolder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`);
}

/**
 * Whether a folder may become a project. Refuses the disk root, the folder of
 * all accounts, the home folder itself, its Library, and system trees; warns
 * on the big catch-all folders (Desktop, Documents, …) and iCloud Drive.
 */
export function folderGuard(rawPath: string, homeDir: string | null): FolderVerdict {
  const path = normalizeFolderPath(rawPath);
  const segments = folderSegments(path);
  if (isWindowsPath(path)) {
    const lower = segments.map((segment) => segment.toLowerCase());
    if (segments.length <= 1) return { kind: "refuse", reason: ROOT_REASON };
    if (
      lower[1] === "windows" ||
      lower[1]?.startsWith("program files") ||
      lower[1] === "programdata"
    ) {
      return { kind: "refuse", reason: SYSTEM_REASON };
    }
    if (lower[1] === "users") {
      if (segments.length === 2) return { kind: "refuse", reason: USERS_REASON };
      if (segments.length === 3) return { kind: "refuse", reason: HOME_REASON };
      if (lower[3] === "appdata") return { kind: "refuse", reason: SYSTEM_REASON };
      if (segments.length === 4 && BROAD_HOME_FOLDERS.some((f) => f.toLowerCase() === lower[3])) {
        return { kind: "warn", reason: broadReason(segments[3]!) };
      }
    }
    return { kind: "ok" };
  }
  if (path === "/" || path === "") return { kind: "refuse", reason: ROOT_REASON };
  if (path === "/Users" || path === "/home") return { kind: "refuse", reason: USERS_REASON };
  if (path === "/Volumes") return { kind: "refuse", reason: ROOT_REASON };
  if (SYSTEM_ROOTS_POSIX.some((root) => startsWithFolder(path, root))) {
    return { kind: "refuse", reason: SYSTEM_REASON };
  }
  const home = homeDir ? normalizeFolderPath(homeDir) : homeDirectoryFrom(path);
  if (home !== null) {
    if (path === home) return { kind: "refuse", reason: HOME_REASON };
    const icloud = `${home}/Library/Mobile Documents`;
    if (startsWithFolder(path, icloud)) {
      const depth = folderSegments(path).length - folderSegments(icloud).length;
      // The iCloud Drive root (`…/com~apple~CloudDocs`) is as broad as Documents.
      return depth <= 1 ? { kind: "warn", reason: broadReason("iCloud Drive") } : { kind: "ok" };
    }
    if (startsWithFolder(path, `${home}/Library`)) return { kind: "refuse", reason: SYSTEM_REASON };
    for (const folder of BROAD_HOME_FOLDERS) {
      if (path === `${home}/${folder}`) return { kind: "warn", reason: broadReason(folder) };
    }
  } else if (segments.length === 2 && (segments[0] === "Users" || segments[0] === "home")) {
    return { kind: "refuse", reason: HOME_REASON };
  }
  return { kind: "ok" };
}

function broadReason(folder: string): string {
  return `This is your whole ${folder} folder. SKYCOT would keep versions of everything in it. A folder inside it that holds just this website or app is usually what you want.`;
}

/** Dot-folders (`.git`, `.aws`, `.config`) are tool storage, never a project. */
export function isHiddenFolder(name: string): boolean {
  return name.startsWith(".");
}

export function visibleEntries(
  entries: ReadonlyArray<FilesystemBrowseEntry>,
  showHidden: boolean,
): ReadonlyArray<FilesystemBrowseEntry> {
  return showHidden ? entries : entries.filter((entry) => !isHiddenFolder(entry.name));
}

/**
 * The crumbs for a path, with the disk root named and the home folder read
 * as "Home": `/Users/mark/Sites/cafe` → ["This Mac", "Home", "Sites", "cafe"].
 */
export function folderCrumbs(path: string, homeDir: string | null): ReadonlyArray<string> {
  const normalized = normalizeFolderPath(path);
  const segments = folderSegments(normalized);
  const home = homeDir ? normalizeFolderPath(homeDir) : homeDirectoryFrom(normalized);
  const homeSegments = home ? folderSegments(home) : null;
  if (
    homeSegments &&
    homeSegments.length <= segments.length &&
    homeSegments.every((segment, index) => segment === segments[index])
  ) {
    return ["Home", ...segments.slice(homeSegments.length)];
  }
  return ["This Mac", ...segments];
}

/** One line for a path in a sentence or subtitle: "Home › Sites › cafe". */
export function plainFolderPath(path: string, homeDir: string | null = null): string {
  return folderCrumbs(path, homeDir).join(" › ");
}

/**
 * Where the browser opens: what the person browsed last, else the parent of
 * their most recent project, else the home folder, else wherever the engine
 * runs. Never the engine's own source folder when a home can be found.
 */
export function defaultBrowseStart(input: {
  readonly remembered: string | null;
  readonly lastProjectRoot: string | null;
  readonly cwd: string | null;
}): string {
  if (input.remembered) return input.remembered;
  if (input.lastProjectRoot) {
    const segments = folderSegments(input.lastProjectRoot);
    if (segments.length > 1) {
      return isWindowsPath(input.lastProjectRoot)
        ? `${segments.slice(0, -1).join("\\")}\\`
        : `/${segments.slice(0, -1).join("/")}/`;
    }
  }
  if (input.cwd) {
    const home = homeDirectoryFrom(input.cwd);
    if (home) return `${home}${isWindowsPath(home) ? "\\" : "/"}`;
    return input.cwd;
  }
  return "/";
}
