// nondev-seam: skycot-policy-files
// What a child's commands may read and write while the Family profile is on: one picture of
// "inside the project", shared by Claude Code's sandbox around a child's Claude
// (SkycotFamilyClaude.familySandbox) and the macOS sandbox SKYCOT puts around the programs it
// starts in a child's project itself (the live preview, SkycotPreview).
//
// First principles (pre-open-source review F1-R1, 3 Nov 2026). A list of secret places is never
// complete: the first sandbox kept SKYCOT's homes and the grown-up's keys unreadable, and a
// child's command could still read ~/Documents, the shell history, browser cookies, a brother's
// project and the grown-up's own Claude scratch folder. Whatever is read reaches the AI and can
// be copied into the project. So reads are turned around: the home folder, every other account,
// external drives and the shared temporary folders are unreadable, and only what the work needs
// comes back:
//   - the project (and its real path, symlinks resolved);
//   - the conversation's own temporary folder (`makeFamilyTempDir`), which also keeps it out of
//     the temporary folder every other Claude session on this Mac shares (F1-R4);
//   - the toolchains: every folder on PATH that sits in an unreadable place, the install it
//     belongs to (`~/anaconda3/bin` brings back `~/anaconda3`, never a home folder or
//     `~/.local`), and the usual version managers' folders (nvm, volta, pyenv, Library/pnpm…).
// Inside those, SKYCOT's own state and the grown-up's keys stay unreadable: the more exact rule
// wins in both sandboxes (checked live with Claude Code 2.1.296).
//
// Writes stay inside the project and the temporary folder; the project's `.git` (SKYCOT's saved
// versions, the engine's own checkpoints) is never writable (F1-R5), nor SKYCOT's state.

// @effect-diagnostics-next-line nodeBuiltinImport:off -- synchronous realpath and mkdtemp, called from the SDK's option builder.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- path arithmetic for sandbox rules.
import * as NodePath from "node:path";

/** Where things are on this Mac, for one child's conversation. */
export interface FamilyPlaces {
  /** The macOS account's home folder. */
  readonly home: string;
  /** The engine's T3 home (userdata, runtime, tools, worktrees, scratch), when known. */
  readonly engineHome?: string | undefined;
  /** The engine's state folder (`<T3 home>/userdata`), which holds the attachments folder. */
  readonly stateDir?: string | undefined;
  /** The project (or the conversation's private copy) the child works in. */
  readonly cwd: string | undefined;
  /** This conversation's own temporary folder (`makeFamilyTempDir`). */
  readonly tmpDir?: string | undefined;
  /** The PATH the child's commands get, for the toolchains to read again. */
  readonly pathEnv?: string | undefined;
  readonly platform: NodeJS.Platform;
  /** The account's user id, for the temporary folder Claude Code shares between sessions. */
  readonly uid?: number | undefined;
}

export interface FamilyFilesystem {
  readonly denyRead: ReadonlyArray<string>;
  readonly allowRead: ReadonlyArray<string>;
  /** Where writes may go besides what the sandbox already allows (Claude: none). */
  readonly allowWrite: ReadonlyArray<string>;
  readonly denyWrite: ReadonlyArray<string>;
}

/** Folders outside the home that hold other people's or other programs' files. */
const DENIED_ROOTS: Partial<Record<NodeJS.Platform, ReadonlyArray<string>>> = {
  darwin: ["/Users", "/Volumes", "/private/tmp", "/private/var/tmp", "/private/var/folders"],
  linux: ["/home", "/root", "/tmp", "/var/tmp", "/mnt", "/media", "/run/user"],
};

/**
 * Inside the home folder: SKYCOT's own homes and app data, and where the grown-up keeps keys and
 * sign-ins. The home is unreadable already; these stay unreadable even inside a toolchain folder
 * or a project that is read again.
 */
const PRIVATE_HOME_PLACES = [
  ".skycot",
  ".skycot-family",
  ".t3",
  "Library/Application Support/SKYCOT",
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gh",
  ".config/gcloud",
  "Library/Keychains",
  ".codex",
  ".claude",
  ".claude.json",
  ".netrc",
  ".npmrc",
  ".git-credentials",
  ".docker",
  ".kube",
  ".cargo/credentials",
  ".cargo/credentials.toml",
  ".gem/credentials",
  ".pypirc",
];

/** Version managers and per-user installs a build may need, read again when present. */
const TOOLCHAIN_HOME_PLACES = [
  ".nvm",
  ".volta",
  ".fnm",
  ".local/share/fnm",
  ".local/share/mise",
  ".asdf",
  ".pyenv",
  ".rbenv",
  ".bun/bin",
  ".deno/bin",
  ".cargo/bin",
  ".rustup/toolchains",
  "Library/pnpm",
  ".local/share/pnpm",
  "Library/Python",
  ".cache/node/corepack",
  "anaconda3",
  "miniconda3",
  "miniforge3",
];

/** A PATH folder with one of these names belongs to the install around it. */
const BIN_FOLDERS = new Set(["bin", "sbin", "condabin"]);
/** Folders that hold many unrelated things: never read again as a whole. */
const CONTAINER_NAMES = new Set([
  ".local",
  "share",
  "lib",
  "Library",
  ".config",
  "Application Support",
  "Documents",
  "Desktop",
  "Downloads",
]);

/** The engine's own state below its T3 home: never writable by a child's command. */
const ENGINE_STATE = ["userdata", "runtime", "tools", "bin", "caches", "origin-secret.txt"];

const unique = (paths: ReadonlyArray<string>) => [...new Set(paths)];

export function isWithin(root: string, target: string): boolean {
  const relative = NodePath.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
}

/** The real path when it exists (`/tmp` -> `/private/tmp`), else the path as given. */
export function realOrSelf(path: string): string {
  try {
    return NodeFS.realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Pure apart from `realpath` and `exists` (injectable for tests): the Family profile's
 * filesystem rules for one conversation.
 */
export function familyFilesystem(
  places: FamilyPlaces,
  io: {
    readonly realpath?: (path: string) => string;
    readonly exists?: (path: string) => boolean;
  } = {},
): FamilyFilesystem {
  const realpath = io.realpath ?? realOrSelf;
  const exists = io.exists ?? NodeFS.existsSync;
  const both = (path: string) => unique([path, realpath(path)]);
  const platform = places.platform;
  const home = places.home;

  const deniedRoots = unique([...both(home), ...(DENIED_ROOTS[platform] ?? [])]);
  const privatePlaces = unique([
    ...PRIVATE_HOME_PLACES.flatMap((place) => both(NodePath.join(home, place))),
    ...(places.engineHome === undefined ? [] : both(places.engineHome)),
    ...(places.stateDir === undefined ? [] : both(places.stateDir)),
  ]);
  const unreadable = (path: string) => deniedRoots.some((root) => isWithin(root, path));
  // A folder that is, or sits in, one of SKYCOT's or the grown-up's private places. One that
  // holds one (`~/.cargo` holds its credentials) may come back: the private place inside is
  // denied by a more exact rule.
  const inPrivate = (path: string) => privatePlaces.some((place) => isWithin(place, path));
  // A home folder or a folder of many unrelated things: never read again as a whole.
  const tooBroad = (path: string) =>
    deniedRoots.includes(path) ||
    both(home).includes(path) ||
    ["/Users", "/home"].includes(NodePath.dirname(path)) ||
    path === "/root" ||
    CONTAINER_NAMES.has(NodePath.basename(path));

  const toolchains: Array<string> = [];
  const keep = (path: string) => {
    if (unreadable(path) && !inPrivate(path) && !tooBroad(path)) toolchains.push(path);
  };
  for (const place of TOOLCHAIN_HOME_PLACES) {
    const path = NodePath.join(home, place);
    if (exists(path)) both(path).forEach(keep);
  }
  for (const dir of (places.pathEnv ?? "").split(NodePath.delimiter)) {
    if (!NodePath.isAbsolute(dir)) continue;
    const real = realpath(dir);
    if (!unreadable(real)) continue;
    keep(dir);
    keep(real);
    if (BIN_FOLDERS.has(NodePath.basename(real))) keep(NodePath.dirname(real));
  }

  const cwd = places.cwd;
  const project = cwd === undefined ? [] : both(cwd);
  const tmp = places.tmpDir === undefined ? [] : both(places.tmpDir);
  const uid = places.uid ?? process.getuid?.() ?? 0;
  // Claude Code's shared temporary folder: every grown-up session's scratch files live there.
  const sharedClaudeTmp = both(
    platform === "darwin" ? `/private/tmp/claude-${uid}` : `/tmp/claude-${uid}`,
  );
  return {
    denyRead: unique([...deniedRoots, ...privatePlaces]),
    allowRead: unique([...project, ...tmp, ...toolchains]),
    allowWrite: unique([...project, ...tmp]),
    denyWrite: unique([
      ...(places.engineHome === undefined
        ? []
        : ENGINE_STATE.flatMap((name) => both(NodePath.join(places.engineHome!, name)))),
      ...(places.stateDir === undefined ? [] : both(places.stateDir)),
      ...project.map((root) => NodePath.join(root, ".git")),
      ...sharedClaudeTmp,
    ]),
  };
}

// ── Environment ─────────────────────────────────────────────────────────────────────────────

/**
 * The only environment variables a child's command keeps: where programs and toolchains are,
 * the terminal and the language. Everything else the engine or the grown-up's shell set (keys,
 * tokens, sockets such as SSH_AUTH_SOCK, npm_config_* steering installs) is left out, whatever
 * its name (F1-R8: a name-based filter missed `*_KEY` and `*_PAT`).
 */
const ALLOWED_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TERM_PROGRAM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "PWD",
  "SHLVL",
  "__CF_USER_TEXT_ENCODING",
  "CLAUDE_CODE_TMPDIR",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
  "NVM_DIR",
  "NVM_BIN",
  "NVM_INC",
  "VOLTA_HOME",
  "PNPM_HOME",
  "BUN_INSTALL",
  "DENO_INSTALL",
  "PYENV_ROOT",
  "PYENV_SHELL",
  "RBENV_ROOT",
  "ASDF_DIR",
  "ASDF_DATA_DIR",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "CONDA_EXE",
  "CONDA_PYTHON_EXE",
  "CONDA_SHLVL",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "MANPATH",
  "INFOPATH",
  "JAVA_HOME",
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "DEVELOPER_DIR",
  "SDKROOT",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
]);
const ALLOWED_ENV_PATTERN = /^(?:LC_[A-Z_]+|GIT_CONFIG_(?:KEY|VALUE)_\d+)$/;

export function isAllowedChildEnv(name: string): boolean {
  return ALLOWED_ENV.has(name) || ALLOWED_ENV_PATTERN.test(name);
}

/**
 * Git inside a child's sandbox: the grown-up's ~/.gitconfig is unreadable (and may hold tokens
 * in `url.…insteadOf`), and git stops when it can't read it, so commands get no global config
 * and no global ignore file. SKYCOT's own git, outside the sandbox, is unchanged.
 */
export const FAMILY_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.excludesFile",
  GIT_CONFIG_VALUE_0: "/dev/null",
} as const;

// ── The conversation's own temporary folder ─────────────────────────────────────────────────

/**
 * Claude Code keeps its temporary files in `<CLAUDE_CODE_TMPDIR>/claude-<uid>` and falls back to
 * the shared `/tmp/claude-<uid>` for commands when that path is longer than 44 bytes (it holds
 * sockets), so the folder is short: `/private/tmp/skycot-<uid>/<6 letters>`.
 */
const CLAUDE_TMP_LIMIT = 44;

export class FamilyTempDirError extends Error {}

/**
 * A fresh private folder for one conversation, inside a per-account folder SKYCOT made itself
 * (owner only, not a link: another account can't plant it). The caller removes it.
 */
export function makeFamilyTempDir(
  uid: number = process.getuid?.() ?? 0,
  tmpRoot: string = realOrSelf("/tmp"),
): string {
  const base = NodePath.join(tmpRoot, `skycot-${uid}`);
  try {
    NodeFS.mkdirSync(base, { mode: 0o700 });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
  }
  const stat = NodeFS.lstatSync(base);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) {
    throw new FamilyTempDirError(`${base} is not this account's own folder.`);
  }
  if ((stat.mode & 0o077) !== 0) NodeFS.chmodSync(base, 0o700);
  const dir = NodeFS.mkdtempSync(`${base}/`);
  if (Buffer.byteLength(NodePath.join(dir, `claude-${uid}`)) > CLAUDE_TMP_LIMIT) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
    throw new FamilyTempDirError(`${dir} is too long for Claude Code's temporary folder.`);
  }
  return dir;
}

// ── macOS sandbox for programs SKYCOT starts in a child's project ───────────────────────────

const sbString = (path: string) => `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const subpaths = (paths: ReadonlyArray<string>) =>
  paths.map((path) => `(subpath ${sbString(path)})`).join(" ");

/**
 * A macOS sandbox profile (sandbox-exec) with the same rules, for a program SKYCOT itself starts
 * in a child's project: deny everything, take the system's own base profile, then allow running
 * programs, reading the system and the places above, writing only in the project and its
 * temporary folder, and (for a live preview) serving on this Mac's own address and nothing else:
 * no internet, no connection to other programs on this Mac (SKYCOT's engine included), no
 * Apple Events, no Launch Services, so nothing can be started outside the sandbox.
 */
export function familySeatbeltProfile(
  filesystem: FamilyFilesystem,
  network: "serve-locally" | "none",
): string {
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-fork process-exec)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow user-preference-read)",
    "(allow ipc-posix-shm ipc-posix-sem)",
    "(allow pseudo-tty)",
    "(allow file-ioctl)",
    // File watching for dev servers that reload on save.
    '(allow mach-lookup (global-name "com.apple.FSEvents"))',
    "(allow file-read*)",
    `(deny file-read* ${subpaths(filesystem.denyRead)})`,
  ];
  if (filesystem.allowRead.length > 0) {
    lines.push(`(allow file-read* ${subpaths(filesystem.allowRead)})`);
  }
  // Places inside a folder read again stay private (the more exact rule comes last).
  const nestedPrivate = filesystem.denyRead.filter((path) =>
    filesystem.allowRead.some((allowed) => allowed !== path && isWithin(allowed, path)),
  );
  if (nestedPrivate.length > 0) lines.push(`(deny file-read* ${subpaths(nestedPrivate)})`);
  lines.push(
    // Looking a name up (stat) is not reading it; programs resolve their own folders this way.
    "(allow file-read-metadata)",
    `(allow file-write* ${subpaths(filesystem.allowWrite)} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/ttys[0-9]+$") (subpath "/dev/fd"))`,
  );
  if (filesystem.denyWrite.length > 0) {
    lines.push(`(deny file-write* ${subpaths(filesystem.denyWrite)})`);
  }
  if (network === "serve-locally") {
    lines.push(
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
    );
  }
  return `${lines.join("\n")}\n`;
}
