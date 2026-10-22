// File-path facts shared by the server policy and the plain client: which files an approval
// prompt names, and whether a path lies outside the project. Pure string logic.

export type PromptFileOperation = "add" | "remove" | "change";

export interface PromptFile {
  readonly path: string;
  readonly operation: PromptFileOperation;
}

const PROMPT_FILE_VERB =
  /^(update|add|remove|create|delete|modify|edit|write|change|read|open|view|rename|move)\s+/i;
/** Claude's fallback summary: `Write: /abs/path`, `Read: /abs/path`, `Edit: /abs/path`. */
const TOOL_PREFIX = /^(write|edit|multiedit|notebookedit|read|glob|grep|ls|create|delete)\s*:\s+/i;

/** `/Users/…`, `~/…`, `C:\…`: a path that cannot be the first word of a sentence. */
const ABSOLUTE_PATH = /^(\/|~[\\/]|[A-Za-z]:\\)/;

/**
 * The full paths on one line: split only where another full path starts (or at a rename's
 * `->`), so a space inside a folder name stays part of the path and a second path is never
 * hidden behind the first.
 */
function splitFullPaths(rest: string): Array<string> {
  return rest.split(/\s+->\s+|\s+(?=\/|~[\\/]|[A-Za-z]:\\)/).filter((part) => part.length > 0);
}

function promptOperation(verb: string | undefined): PromptFileOperation {
  const value = verb?.toLowerCase() ?? "";
  if (value === "add" || value === "create" || value === "write") return "add";
  if (value === "remove" || value === "delete") return "remove";
  return "change";
}

/**
 * The files an approval prompt names. Providers phrase these differently: Codex sends one
 * `update /abs/path` or `delete /abs/path` per line, Claude a bare path or `Tool: path`,
 * others "Edit 3 files: index.html, menu.html, style.css".
 */
export function filesFromPrompt(prompt: string | undefined): Array<PromptFile> {
  if (!prompt) return [];
  const files: Array<PromptFile> = [];
  const seen = new Set<string>();
  const push = (path: string, operation: PromptFileOperation) => {
    const clean = path.replace(/[,;]+$/, "").trim();
    if (clean.length === 0 || seen.has(clean)) return;
    seen.add(clean);
    files.push({ path: clean, operation });
  };
  for (const raw of prompt.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("+")) continue;
    const several = line.match(/^(\w+)\s+\d+\s+files?:\s*(.+)$/i);
    if (several) {
      for (const path of several[2]!.split(/[,\s]+/)) push(path, promptOperation(several[1]));
      continue;
    }
    const tool = line.match(TOOL_PREFIX);
    if (tool) {
      const rest = line.replace(TOOL_PREFIX, "").trim();
      if (rest.length > 0 && !/\s{2,}/.test(rest))
        for (const path of ABSOLUTE_PATH.test(rest)
          ? splitFullPaths(rest)
          : [rest.split(/\s+/)[0]!])
          push(path, promptOperation(tool[1]));
      continue;
    }
    const verb = line.match(PROMPT_FILE_VERB)?.[1];
    const rest = line.replace(PROMPT_FILE_VERB, "").trim();
    // Two or more spaces means prose, not a path; a single space may still be "verb path".
    if (rest.length === 0 || /\s{2,}/.test(rest)) continue;
    // A full path is the whole rest of the line: folders are often named with spaces
    // ("Little Fern Café website"), and the engine names a private copy after the project.
    if (verb !== undefined && ABSOLUTE_PATH.test(rest)) {
      const renamed = /\s->\s/.test(rest);
      splitFullPaths(rest).forEach((path, index) =>
        push(path, renamed && index > 0 ? "add" : promptOperation(verb)),
      );
      continue;
    }
    const [first, arrow, second] = rest.split(/\s+/);
    // "Edit the booking page": several words and the first is not path-shaped is prose.
    if (arrow !== undefined && !/[\\/.]/.test(first!)) continue;
    push(first!, promptOperation(verb));
    // Codex rename: `update old -> new`.
    if (arrow === "->" && second) push(second, "add");
  }
  return files;
}

const SYSTEM_PREFIX =
  /^(~|\$HOME|\$\{HOME\}|\/etc|\/usr|\/var|\/private|\/System|\/Library|\/Applications|\/opt|\/bin|\/sbin|[A-Za-z]:\\)/;
const HARMLESS_DEVICES = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/stdin",
  "/dev/tty",
]);

function normalizeRoot(root: string): string {
  return root.replace(/[\\/]+$/, "");
}

/** `/a/b` is under `/a` but `/ab` is not. */
function isUnder(path: string, root: string): boolean {
  const r = normalizeRoot(root);
  return path === r || path.startsWith(`${r}/`) || path.startsWith(`${r}\\`);
}

type ProjectRoots = string | undefined | null | ReadonlyArray<string | undefined | null>;

/**
 * True when a path escapes the project: the thread's private copy and the project's own
 * folder both count as inside. Relative paths count as outside only when they climb with
 * `..`. Without a known root, only well-known system and home prefixes count.
 */
export function isOutsideProject(path: string | undefined, projectRoots: ProjectRoots): boolean {
  if (!path) return false;
  if (HARMLESS_DEVICES.has(path)) return false;
  const roots = (typeof projectRoots === "string" ? [projectRoots] : (projectRoots ?? [])).filter(
    (root): root is string => typeof root === "string" && root.length > 0,
  );
  const inside = roots.some((root) => isUnder(path, root));
  if (SYSTEM_PREFIX.test(path)) return !inside;
  if (path.startsWith("/")) return roots.length > 0 && !inside;
  return /(^|[\\/])\.\.([\\/]|$)/.test(path);
}

/**
 * True when the thread works in a private copy and `path` lies in the project's own folder
 * instead. Undo restores the private copy; it never reaches the real folder, so a change
 * there is not covered. A copy kept inside the project folder still counts as the copy, and a
 * relative path is the copy's own.
 */
export function isInRealProjectFolder(
  path: string | undefined,
  privateCopy: string | undefined | null,
  projectFolder: string | undefined | null,
): boolean {
  if (!path || !privateCopy || !projectFolder) return false;
  if (normalizeRoot(privateCopy) === normalizeRoot(projectFolder)) return false;
  if (isUnder(path, privateCopy)) return false;
  return isUnder(path, projectFolder);
}

const SECRET_PATH_PATTERN =
  /(^|[\\/])(\.env(\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|secrets?(\.[\w.-]+)?|id_rsa|id_ed25519|id_ecdsa|known_hosts|authorized_keys|\.ssh|\.aws|\.gnupg|\.docker\/config\.json|keychain)$|\.(pem|key|p12|pfx|jks|keystore)$/i;

/**
 * The assistants' own sign-in and settings files: `~/.codex/auth.json`, `~/.codex/config.toml`,
 * `~/.claude/.credentials.json`, and anything token-named under either folder.
 */
const PROVIDER_SECRET_PATTERN =
  /(^|[\\/])\.(codex|claude)[\\/](.*[\\/])?(auth\.json|config\.toml|\.credentials[^\\/]*|[^\\/]*token[^\\/]*)$/i;

/** A path whose contents are usually keys, passwords or tokens. `.env.example` is not. */
export function isSecretPath(path: string): boolean {
  if (/\.env\.(example|sample|template|dist)$/i.test(path)) return false;
  return SECRET_PATH_PATTERN.test(path) || PROVIDER_SECRET_PATTERN.test(path);
}

/** `a/b/../c` → `a/c`; null when the path climbs above where it started. */
function collapseDots(path: string): string | null {
  const parts: Array<string> = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** The home folder however a command spells it: `~`, `$HOME`, `/Users/me`, `/home/me`. */
const HOME_PREFIX = /^(~|\$HOME|\$\{HOME\}|\/Users\/[^/]+|\/home\/[^/]+|\/root|\/var\/root)\//;
const INSTRUCTION_FOLDER = /^\.(codex|claude)\/(plugins|skills)(\/|$)/;

/**
 * True for the assistants' own plugin and skill instructions (`~/.codex/plugins/…/SKILL.md`,
 * `~/.claude/skills/…`): reading them is the assistant reading its own manual, not the
 * person's files. Never true for a secret-looking file, even inside those folders, or for a
 * path that climbs out of them with `..`.
 */
export function isProviderInstructionPath(path: string): boolean {
  const home = HOME_PREFIX.exec(path);
  if (home === null) return false;
  const rest = collapseDots(path.slice(home[0].length));
  if (rest === null || !INSTRUCTION_FOLDER.test(rest)) return false;
  return !isSecretPath(rest) && !/(^|\/)\.env[^/]*$|\.pem$/i.test(rest);
}
