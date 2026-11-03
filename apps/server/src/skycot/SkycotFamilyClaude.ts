// nondev-seam: skycot-policy-files
// Family lockdown for Claude (see SkycotFamilyLockdown.ts for when it applies).
//
// The Claude Agent SDK loads everything the parent set up for Claude Code unless told not to:
// user, project and local settings (enabled plugins, hooks, permission rules, the parent's
// CLAUDE.md), MCP servers from ~/.claude.json, `.mcp.json`, plugins and claude.ai connectors,
// skills, and Claude in Chrome. While the Family profile is on, every query a child's session
// opens is given options that switch all of it off:
//
//   - `settingSources: []`: no settings file is read, so no enabled plugin, hook, permission
//     rule or CLAUDE.md of the parent's reaches the child (SKYCOT's own permission callback and
//     mode still apply: they are options, not settings).
//   - `strictMcpConfig: true` with only the servers SKYCOT passes (none in Family, F18): every
//     other MCP configuration is ignored, plugins' and agents' included; claude.ai connectors
//     are also switched off by environment.
//   - `plugins: []`, `skills: []` (no skill is enabled), `disableAllHooks` in the session's own
//     settings, and `--no-chrome`.
//
// Applied where the query is opened (seam skycot-family-lockdown-claude), below every turn,
// restart and resume. Limits (FAMILY.md): Claude Code's built-in tools stay; administrator-
// managed settings, which a family does not normally have, still apply as Claude intends.
//
// Containment (pre-open-source review F1, 3 Nov 2026). The rule engine reads a command's
// words, so `node -e "require('fs').unlinkSync(…)"` or a script the project runs can reach
// anything the child's macOS account can. The promise "SKYCOT always asks before leaving the
// project" is therefore kept by the operating system, as Codex's is by its own sandbox:
//   - every Bash command runs in Claude Code's sandbox (`familySandbox`, rules in
//     SkycotFamilySandbox): reads only in the project, the conversation's own temporary folder
//     and the toolchains; writes only in the project (never its `.git`) and that folder; no
//     internet; only the environment variables a build needs; no way out of the sandbox; and
//     SKYCOT's permission callback still judges every command. If the sandbox can't start, the
//     temporary folder can't be made or Claude Code is older than FAMILY_CLAUDE_MIN_VERSION,
//     nothing runs (plain refusals before the query is opened, `failIfUnavailable` inside);
//   - Claude's own file tools (Read, Write, Edit, Glob, Grep…) run in Claude's process, not in
//     the sandbox, so the permission callback refuses any of them that points outside the
//     project (`fileToolRefusal`), symlinks and `..` resolved first, and any through a link
//     whose target isn't there yet.
// A grown-up's yes to an install or a download is done by SKYCOT itself outside the sandbox
// (SkycotApprovedInstalls), exactly as for Codex.

// @effect-diagnostics-next-line nodeBuiltinImport:off -- `claude --version` before a child's first query.
import * as NodeChildProcess from "node:child_process";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- a synchronous realpath inside the SDK's permission callback.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- path arithmetic for sandbox settings.
import * as NodePath from "node:path";

import type { PermissionMode, SandboxSettings } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type { FamilyLockdown } from "./SkycotFamilyLockdown.ts";
import * as SkycotFamilySandbox from "./SkycotFamilySandbox.ts";

/** The SDK query options SKYCOT touches; the rest pass through unchanged. */
export interface ClaudeLockableOptions {
  readonly cwd?: string | undefined;
  readonly permissionMode?: PermissionMode | undefined;
  readonly allowDangerouslySkipPermissions?: boolean | undefined;
  readonly sandbox?: SandboxSettings | undefined;
  readonly settingSources?: ReadonlyArray<"user" | "project" | "local"> | undefined;
  readonly strictMcpConfig?: boolean | undefined;
  readonly mcpServers?: Readonly<Record<string, unknown>> | undefined;
  readonly plugins?: ReadonlyArray<unknown> | undefined;
  readonly skills?: ReadonlyArray<string> | "all" | undefined;
  readonly settings?: unknown;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly extraArgs?: Readonly<Record<string, string | null>> | undefined;
}

/**
 * T3's Claude text generation (titles, commit messages) already runs with no tools, no MCP
 * server and no slash commands; while the profile is on, the parent's hooks are off as well.
 */
export function lockTextSettings<S extends object>(
  lockdown: FamilyLockdown | null,
  settings: S,
): S | (S & { readonly disableAllHooks: true }) {
  return lockdown === null ? settings : { ...settings, disableAllHooks: true };
}

/** Environment a Family query runs with on top of its own. */
export const FAMILY_CLAUDE_ENV = {
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  ...SkycotFamilySandbox.FAMILY_GIT_ENV,
} as const;

/** Where SKYCOT's own state lives on this Mac, and this conversation's temporary folder. */
export type FamilySandboxPlaces = Omit<SkycotFamilySandbox.FamilyPlaces, "cwd" | "pathEnv">;

/**
 * The sandbox every Bash command of a child's Claude runs in (SkycotFamilySandbox): reads only
 * in the project, its temporary folder and the toolchains; writes only in the project (never
 * its `.git`, where SKYCOT keeps the versions and whose hooks and config git would run) and
 * the temporary folder; no internet; only the environment variables a build needs.
 */
export function familySandbox(
  places: FamilySandboxPlaces & {
    readonly cwd: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
  io?: Parameters<typeof SkycotFamilySandbox.familyFilesystem>[1],
): SandboxSettings {
  const filesystem = SkycotFamilySandbox.familyFilesystem(
    { ...places, pathEnv: places.env?.PATH },
    io,
  );
  const hiddenEnv = Object.keys(places.env ?? {}).filter(
    (name) => !SkycotFamilySandbox.isAllowedChildEnv(name),
  );
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
    excludedCommands: [],
    network: {
      allowedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowAllUnixSockets: false,
      allowUnixSockets: [],
    },
    filesystem: {
      // Claude Code already lets commands write in the project and its own temporary folder.
      allowWrite: [],
      denyWrite: [...filesystem.denyWrite],
      denyRead: [...filesystem.denyRead],
      allowRead: [...filesystem.allowRead],
    },
    ...(hiddenEnv.length === 0
      ? {}
      : { credentials: { envVars: hiddenEnv.map((name) => ({ name, mode: "deny" as const })) } }),
  };
}

/**
 * Pure: a query's options while the profile is on; the same object when it was off. A
 * settings file path (never passed by the adapter today) is replaced rather than trusted, and
 * so are the grown-up's own launch arguments (`--mcp-config`, `--add-dir`, a permission mode):
 * the child's Claude asks before every step, or plans.
 */
export function lockQueryOptions<O extends ClaudeLockableOptions>(
  lockdown: FamilyLockdown | null,
  options: O,
  places: FamilySandboxPlaces,
): O {
  if (lockdown === null) return options;
  const settings =
    typeof options.settings === "object" && options.settings !== null
      ? { ...(options.settings as Record<string, unknown>), disableAllHooks: true }
      : { disableAllHooks: true };
  const thinking = options.extraArgs?.["thinking-display"];
  const env = {
    ...(options.env ?? process.env),
    ...FAMILY_CLAUDE_ENV,
    ...(places.tmpDir === undefined ? {} : { CLAUDE_CODE_TMPDIR: places.tmpDir }),
  };
  return {
    ...options,
    permissionMode: options.permissionMode === "plan" ? "plan" : "default",
    allowDangerouslySkipPermissions: false,
    settingSources: [],
    strictMcpConfig: true,
    plugins: [],
    skills: [],
    settings,
    sandbox: familySandbox({ ...places, cwd: options.cwd, env }),
    env,
    extraArgs: {
      ...(thinking === undefined ? {} : { "thinking-display": thinking }),
      "no-chrome": null,
    },
  };
}

/** What the child sees when Claude's safe area can't start on this computer. */
export const FAMILY_CLAUDE_SANDBOX_REFUSAL =
  "The Family profile is on, and SKYCOT could not start Claude's safe area on this computer (it keeps Claude's commands inside the project and off the internet), so Claude didn't start. A grown-up can choose Codex for this conversation or switch the Family profile off.";

export class FamilyClaudeSandboxUnavailable extends Schema.TaggedError<FamilyClaudeSandboxUnavailable>()(
  "FamilyClaudeSandboxUnavailable",
  { platform: Schema.String },
) {
  override get message(): string {
    return FAMILY_CLAUDE_SANDBOX_REFUSAL;
  }
}

/**
 * The first Claude Code SKYCOT lets a child's Claude run on: the version the bundled Agent SDK
 * describes (its sandbox settings have every field `familySandbox` sets: reads allowed again
 * inside an unreadable folder, environment variables withheld, the strict network allowlist,
 * `failIfUnavailable`). An older Claude Code may ignore a setting it doesn't know and run the
 * child's commands with less containment than FAMILY.md promises (review F1-R7), so it is refused.
 */
export const FAMILY_CLAUDE_MIN_VERSION = "2.1.276";

/** Whether `claude --version`'s answer is new enough; an answer SKYCOT can't read is not. */
export function claudeVersionSupportsFamily(output: string | null | undefined): boolean {
  const found = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output ?? "");
  if (found === null) return false;
  const have = found.slice(1, 4).map(Number);
  const need = FAMILY_CLAUDE_MIN_VERSION.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (have[index]! !== need[index]!) return have[index]! > need[index]!;
  }
  return true;
}

/** Answers already new enough, by program: asked once per program, not before every turn. */
const supportedVersions = new Map<string, string>();

/**
 * `claude --version`'s output, or null when it would not run (refused as too old). A new enough
 * answer is remembered while the engine runs; an older one is asked again, so updating Claude
 * Code needs no restart.
 */
export const claudeVersionOutput = (
  binaryPath: string,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<string | null> =>
  Effect.suspend(() => {
    const known = supportedVersions.get(binaryPath);
    if (known !== undefined) return Effect.succeed(known);
    return Effect.callback<string | null>((resume) => {
      const child = NodeChildProcess.execFile(
        binaryPath,
        ["--version"],
        { env: env as NodeJS.ProcessEnv, timeout: 15_000, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          const output = error === null ? String(stdout) : null;
          if (output !== null && claudeVersionSupportsFamily(output)) {
            supportedVersions.set(binaryPath, output);
          }
          resume(Effect.succeed(output));
        },
      );
      return Effect.sync(() => child.kill());
    });
  });

/**
 * This conversation's own temporary folder (SkycotFamilySandbox.makeFamilyTempDir), removed
 * when the session ends; undefined when it could not be made, and the child's Claude is then
 * refused like a missing sandbox.
 */
export const scopedFamilyTempDir: Effect.Effect<string | undefined, never, Scope.Scope> =
  Effect.acquireRelease(
    Effect.sync(() => {
      try {
        return SkycotFamilySandbox.makeFamilyTempDir();
      } catch {
        return undefined;
      }
    }),
    (dir) =>
      dir === undefined
        ? Effect.void
        : Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );

/** What the child sees when the installed Claude Code is older than that. */
export const FAMILY_CLAUDE_TOO_OLD_REFUSAL = `The Family profile is on, and the Claude Code on this computer is too old for Claude's safe area (it keeps Claude's commands inside the project and off the internet), so Claude didn't start. A grown-up can update Claude Code to version ${FAMILY_CLAUDE_MIN_VERSION} or newer, choose Codex for this conversation, or switch the Family profile off.`;

export class FamilyClaudeTooOld extends Schema.TaggedError<FamilyClaudeTooOld>()(
  "FamilyClaudeTooOld",
  { version: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    return FAMILY_CLAUDE_TOO_OLD_REFUSAL;
  }
}

/**
 * Whether Claude Code's sandbox can start here: macOS's own `sandbox-exec`, or bubblewrap and
 * socat on Linux. Checked before a child's query is opened so a missing sandbox is a plain
 * refusal; `failIfUnavailable` is the backstop inside Claude Code.
 */
export function familySandboxAvailable(
  platform: NodeJS.Platform,
  pathEnv: string | undefined,
  exists: (path: string) => boolean = NodeFS.existsSync,
): boolean {
  if (platform === "darwin") return exists("/usr/bin/sandbox-exec");
  if (platform !== "linux") return false;
  const onPath = (name: string) =>
    (pathEnv ?? "")
      .split(NodePath.delimiter)
      .some((dir) => dir !== "" && exists(NodePath.join(dir, name)));
  return onPath("bwrap") && onPath("socat");
}

// ── Claude's own file tools ───────────────────────────────────────────────────────────────

/** The tools that read; anything else that names a path is treated as writing. */
const READING_TOOLS = new Set(["Read", "NotebookRead", "Glob", "Grep", "LS"]);
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;
const GLOB_CHARS = /[*?[{]/;

/**
 * The real path, symlinks resolved; for a file not made yet, its nearest real folder's. Null
 * when the path goes through a link whose target is not there yet (review F1-R6): where a
 * write through it would land can't be known, so it is never inside the project.
 */
function realPath(path: string): string | null {
  let current = path;
  const rest: Array<string> = [];
  for (let guard = 0; guard < 256; guard += 1) {
    try {
      return NodePath.join(NodeFS.realpathSync.native(current), ...rest.toReversed());
    } catch {
      if (isLink(current)) return null;
      const parent = NodePath.dirname(current);
      if (parent === current) return path;
      rest.push(NodePath.basename(current));
      current = parent;
    }
  }
  return path;
}

function isLink(path: string): boolean {
  try {
    return NodeFS.lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The fixed folder a glob starts from: `/a/b/**\/*.js` -> `/a/b`; null if `..` follows a wildcard. */
function globBase(pattern: string): string | null {
  const parts = pattern.split("/");
  const fixed: Array<string> = [];
  let wild = false;
  for (const part of parts) {
    if (GLOB_CHARS.test(part)) wild = true;
    else if (wild && part === "..") return null;
    if (!wild) fixed.push(part);
  }
  return fixed.join("/") || (pattern.startsWith("/") ? "/" : ".");
}

/**
 * The family's answer to one of Claude's own file tools, before any card: a sentence for the
 * assistant when the step points outside the project, else null (the step goes on to the
 * rules). Reads may also use the conversation's attachments folder, as Claude is given it.
 */
export function fileToolRefusal(input: {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly cwd: string | null | undefined;
  readonly home: string;
  readonly readRoots?: ReadonlyArray<string>;
}): string | null {
  const targets: Array<string> = [];
  for (const key of PATH_KEYS) {
    const value = input.toolInput[key];
    if (typeof value === "string" && value.trim().length > 0) targets.push(value.trim());
  }
  if (input.toolName === "Glob" && typeof input.toolInput.pattern === "string") {
    const base = globBase(input.toolInput.pattern);
    if (base === null) return FAMILY_OUTSIDE_PROJECT_MESSAGE;
    targets.push(base);
  }
  if (targets.length === 0) return null;
  const cwd = input.cwd;
  if (cwd === undefined || cwd === null) return FAMILY_OUTSIDE_PROJECT_MESSAGE;
  const project = realPath(NodePath.resolve(cwd));
  if (project === null) return FAMILY_OUTSIDE_PROJECT_MESSAGE;
  const writes = !READING_TOOLS.has(input.toolName);
  const roots = writes
    ? [project]
    : [
        project,
        ...(input.readRoots ?? []).flatMap((root) => realPath(NodePath.resolve(root)) ?? []),
      ];
  for (const target of targets) {
    const expanded =
      target === "~" || target.startsWith("~/")
        ? NodePath.join(input.home, target.slice(1))
        : target;
    const real = realPath(NodePath.resolve(cwd, expanded));
    if (real === null || !roots.some((root) => SkycotFamilySandbox.isWithin(root, real))) {
      return FAMILY_OUTSIDE_PROJECT_MESSAGE;
    }
    if (writes && SkycotFamilySandbox.isWithin(NodePath.join(project, ".git"), real)) {
      return FAMILY_OUTSIDE_PROJECT_MESSAGE;
    }
  }
  return null;
}

/** What the assistant is told when one of its file tools points outside the project. */
export const FAMILY_OUTSIDE_PROJECT_MESSAGE =
  "In the Family profile SKYCOT keeps your work inside this project's folder, so this step was not done: it points outside the folder, or at the hidden .git folder where SKYCOT keeps the project's versions. Do not try it again. Carry on inside the project folder, or say in one short sentence that this part needs a grown-up.";

/** The answers key that carries a note for the assistant with a "decline" (SkycotApprovedInstalls). */
export const ASSISTANT_NOTE_ANSWER = "skycotAssistantNote";

/** The note SKYCOT left for the assistant with this answer, if any. */
export function assistantNoteFrom(
  answers: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const note = answers?.[ASSISTANT_NOTE_ANSWER];
  return typeof note === "string" && note.trim().length > 0 ? note : undefined;
}

/**
 * What the assistant is told when the family says no to a step. Plain words, no one's age:
 * "the family said no" is all it needs. A no only ever stops the step; it never allows anything.
 */
export const FAMILY_DECLINED_MESSAGE =
  "The family said no to this step, so it was not done. Do not try it again. Carry on without it: do the job another way that needs no install and no internet, or say in one short sentence that this part needs a grown-up.";

/** The answer to the same step asked again after a no, without raising another card. */
export const FAMILY_DECLINED_AGAIN_MESSAGE =
  "The family already said no to this exact step, so SKYCOT will not ask again. Carry on without it: do the job another way that needs no install and no internet, or say in one short sentence that this part needs a grown-up.";

/**
 * The steps a Family turn's card was answered "no" to, kept for that turn only: the same tool
 * with the same input is refused at once instead of raising the card again. A later message
 * starts clean, so a grown-up who changes their mind can still be asked. Only a "decline" is
 * recorded (Stop is a cancel and is not); nothing here ever answers yes.
 */
export class FamilyDeclinedSteps {
  private readonly keys = new Set<string>();

  private static key(turnId: string, toolName: string, toolInput: unknown): string {
    return JSON.stringify([turnId, toolName, toolInput]);
  }

  record(turnId: string, toolName: string, toolInput: unknown): void {
    this.keys.add(FamilyDeclinedSteps.key(turnId, toolName, toolInput));
  }

  has(turnId: string, toolName: string, toolInput: unknown): boolean {
    return this.keys.has(FamilyDeclinedSteps.key(turnId, toolName, toolInput));
  }
}
