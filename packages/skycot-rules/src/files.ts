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
        push(rest.split(/\s+/)[0]!, promptOperation(tool[1]));
      continue;
    }
    const verb = line.match(PROMPT_FILE_VERB)?.[1];
    const rest = line.replace(PROMPT_FILE_VERB, "").trim();
    // Two or more spaces means prose, not a path; a single space may still be "verb path".
    if (rest.length === 0 || /\s{2,}/.test(rest)) continue;
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

/**
 * True when a path escapes the project folder (the thread's private copy when it has one).
 * Relative paths count as outside only when they climb with `..`. Without a known root,
 * only well-known system and home prefixes count.
 */
export function isOutsideProject(
  path: string | undefined,
  projectRoot: string | undefined | null,
): boolean {
  if (!path) return false;
  if (HARMLESS_DEVICES.has(path)) return false;
  if (SYSTEM_PREFIX.test(path)) return !projectRoot || !isUnder(path, projectRoot);
  if (path.startsWith("/")) return projectRoot ? !isUnder(path, projectRoot) : false;
  return /(^|[\\/])\.\.([\\/]|$)/.test(path);
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
