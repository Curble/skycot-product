// nondev-seam: skycot-policy-files
// Family lockdown for Codex (see SkycotFamilyLockdown.ts for when it applies).
//
// A Codex app-server reads the parent's ~/.codex/config.toml: plugins (computer use, browser,
// Chrome, documents...), apps and connectors, MCP servers, skills, hooks and the `notify`
// program it runs after every turn. While the Family profile is on, SKYCOT starts a separate
// Codex process for the child's conversation and switches all of it off, in three layers:
//
//   1. The process (`lockLaunch`): Codex's own wholesale switches go on its command line as
//      `-c` overrides, the strongest config layer, so neither the parent's file nor a project's
//      `.codex/config.toml` can turn them back on: plugins, apps, hooks, computer use, browser
//      use, remote plugins, plugin suggestions, memories, Codex's bundled skills, and `notify`
//      emptied. A plugin installed tomorrow is off too: no list of names is involved.
//   2. Every thread it starts, resumes or forks (`lockClient`): MCP servers have no wholesale
//      switch (`mcp_servers = {}` merges instead of replacing), so before each thread SKYCOT asks
//      this very process for its effective config at the thread's folder (`config/read`, which
//      includes project layers) and its skills (`skills/list`), and turns each one off by name
//      for that thread. Read fresh every time, so a server or skill added a minute ago is
//      included; the layer-1 switches are repeated per thread as well.
//   3. Proof, fail closed: before the first thread, the process must report the switches off
//      (`config/read`) and list no enabled plugin or app (`plugin/list`, `app/list`). If it
//      cannot, or any MCP server starts for a locked thread anyway, the thread or turn is
//      refused with a plain sentence instead of running with the parent's add-ons.
//
// Why not an isolated CODEX_HOME with only the sign-in: it would also miss nothing in the home,
// but Codex keeps the sign-in (auth.json or the system keychain, keyed by the home's path), the
// thread history and its databases there. A copied auth.json can sign the parent out when its
// refresh token rotates, keychain sign-ins would not be found at all, and a child's earlier
// conversations would no longer resume. Codex's own switches keep one home and lose nothing.
//
// Containment (pre-open-source review F1, 4 Nov 2026). Codex's "workspace-write" sandbox kept a
// command's writes in the project and the internet off, but let it read the whole Mac: the
// family's Documents, browser profiles, ~/.ssh, a brother's project, ~/.skycot. Codex's own
// permission profiles (`[permissions.<id>]`, codex-cli 0.160) restrict reads as well, inside
// the same macOS sandbox Codex already puts around every command and its file edits
// (apply_patch). Its image viewer and helper agents are switched off instead (not shown to keep
// to the profile, review S4), and so are the ways to ask for more (`request_permissions`, extra
// permissions on a command: S2). So a child's thread runs with a profile generated from
// SkycotFamilySandbox, the rules Claude and the preview use:
//   - `familyCodexProfile`: the whole disk readable except homes, other accounts, external
//     drives and the shared temporary folders; the project, the session's own temporary folder
//     and the toolchains readable again; writes only in the project (never its `.git`) and that
//     folder; SKYCOT's state and the grown-up's keys (~/.codex with Codex's own sign-in among
//     them) never readable; no internet. Codex's process itself is not inside it: it reads its
//     sign-in and history as before, and its commands can't. The folders on the way down to the
//     project (the home folder, for one) can be listed, because Node must look each one up;
//     everything else in them stays closed, including what is saved there later
//     (`familyCodexFilesystem`).
//   - `familyCodexShellEnvironment`: commands keep only the environment variables a build needs
//     (SkycotFamilySandbox's list), and Codex's shell snapshot of the grown-up's login shell is
//     off, so nothing the grown-up exported reaches them.
//   - The process starts with a base profile (`FAMILY_CODEX_BASE_PROFILE`: no project, nothing
//     writable) as its default, so a thread that somehow missed the per-thread profile still
//     can't read the family's files. Every thread is started, resumed or forked with the
//     project's profile, every turn is told to use it (the legacy `sandboxPolicy` is taken out),
//     and Codex must answer that the profile is active (`activePermissionProfile`) before the
//     thread may run a turn. Fail closed: no temporary folder, an unknown platform, no folder to
//     work in, or a Codex that does not report the profile, and the conversation is refused with
//     a plain sentence (FAMILY_CODEX_SANDBOX_REFUSAL), as Claude's is.
//
// Limits (FAMILY.md): Codex's built-in shell, file edits, web search and image generation stay
// (the image viewer and helper agents are off); SKYCOT's command policy still asks before the
// risky ones. The parent's AGENTS.md instructions are still read (text, not tools).

// @effect-diagnostics-next-line nodeBuiltinImport:off -- path arithmetic for the permission profile.
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { resolveCodexLaunchArgs } from "../provider/codexLaunchArgs.ts";
import type { FamilyLockdown } from "./SkycotFamilyLockdown.ts";
import * as SkycotFamilySandbox from "./SkycotFamilySandbox.ts";

/** Codex features a child's process runs without. Names Codex does not know are ignored by it. */
export const FAMILY_CODEX_FEATURES_OFF = [
  "plugins",
  "apps",
  "hooks",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "in_app_browser",
  "remote_plugin",
  "plugin_sharing",
  "recommended_plugins",
  "tool_suggest",
  "skill_mcp_dependency_install",
  "enable_mcp_apps",
  "memories",
  // Replays the grown-up's login shell (its exported keys included) into every command.
  "shell_snapshot",
  // Ways for the AI to ask for more than the project profile gives (review S2): a
  // `request_permissions` tool, and extra folders or internet attached to a command's approval.
  "request_permissions_tool",
  "exec_permission_approvals",
  // Not shown to keep to the profile (review S4): the image viewer reads a file in Codex's own
  // process, and helper agents are threads SKYCOT never starts or checks itself.
  "view_image",
  "multi_agent",
  "multi_agent_v2",
] as const;

/**
 * The switches the process must report off before a child's thread starts (codex-cli 0.160.1
 * reports each of them in `config/read`, checked live).
 */
export const FAMILY_CODEX_REQUIRED_OFF = [
  "plugins",
  "apps",
  "hooks",
  "computer_use",
  "browser_use",
  "request_permissions_tool",
  "exec_permission_approvals",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
] as const;

/** Config every Family process and thread carries (dotted keys, Codex's `-c` form). */
export const FAMILY_CODEX_CONFIG: Readonly<Record<string, Schema.Json>> = {
  ...Object.fromEntries(FAMILY_CODEX_FEATURES_OFF.map((name) => [`features.${name}`, false])),
  notify: [],
  "skills.bundled.enabled": false,
};

/** The same, as app-server launch arguments. Values are TOML without spaces, so no quoting. */
export const FAMILY_CODEX_LAUNCH_ARGS: ReadonlyArray<string> = Object.entries(
  FAMILY_CODEX_CONFIG,
).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);

const T3CODE_CODEX_LAUNCH_ARGS_ENV = "T3CODE_CODEX_LAUNCH_ARGS";

// ── Containment: Codex permission profiles generated from SkycotFamilySandbox ────────────────

/**
 * The profile a child's thread runs with: its project, readable and writable. A session's real
 * ids carry a random part (`sessionPlaces`, review S1): Codex merges every config layer into a
 * profile of the same name (the grown-up's ~/.codex/config.toml, a trusted project's
 * `.codex/config.toml`), and a merged `"<project>/.git/hooks" = "write"` was confirmed live, so
 * no other layer may know the name in advance. These fixed names are only the fallback.
 */
export const FAMILY_CODEX_PROFILE = "skycot_family";
/** The process's default: the same reads with no project, and nothing writable. */
export const FAMILY_CODEX_BASE_PROFILE = "skycot_family_base";

/** The ids of a session's two profiles: the thread's, and the process's base (`<id>_base`). */
export function familyProfileIds(places: Pick<FamilyCodexPlaces, "profileId"> | undefined): {
  readonly thread: string;
  readonly base: string;
} {
  const thread = places?.profileId ?? FAMILY_CODEX_PROFILE;
  return { thread, base: `${thread}_base` };
}

/** A fresh profile id for one session: never guessable by another config layer. */
export const randomFamilyProfileId = (): string =>
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- a synchronous, pure helper (Web Crypto is a CSPRNG); sessionPlaces must not need a new service upstream.
  `${FAMILY_CODEX_PROFILE}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;

/** Platforms whose Codex sandbox enforces read rules (seatbelt on macOS, bubblewrap on Linux). */
const CONTAINED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux"]);

/** Where things are on this Mac for one child's Codex session. */
export interface FamilyCodexPlaces {
  readonly home: string;
  readonly engineHome?: string | undefined;
  readonly stateDir?: string | undefined;
  /** The session's own temporary folder (SkycotFamilySandbox.scopedFamilyTempDir). */
  readonly tmpDir: string | undefined;
  /** The PATH Codex's commands get, for the toolchains to be read again. */
  readonly pathEnv?: string | undefined;
  readonly platform: NodeJS.Platform;
  /** The session's folder, for a thread request that names none. */
  readonly cwd?: string | undefined;
  /** Codex's own home (sign-in, history): never readable by a command, wherever it is. */
  readonly codexHome?: string | undefined;
  readonly uid?: number | undefined;
  /** This session's profile id (`randomFamilyProfileId`); the fixed name when absent. */
  readonly profileId?: string | undefined;
}

/**
 * The places for one Family Codex session, with the session's own temporary folder (removed
 * when the session ends; undefined when it could not be made, and every thread is then refused).
 */
export const sessionPlaces: (input: {
  readonly engineHome: string;
  readonly stateDir: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly codexHomePath: string | undefined;
  readonly cwd: string | null | undefined;
}) => Effect.Effect<FamilyCodexPlaces, never, Scope.Scope> = Effect.fn(
  "SkycotFamilyCodex.sessionPlaces",
)(function* (input) {
  const home = yield* HostProcess.HomeDirectory;
  const codexHome =
    input.environment.CODEX_HOME?.trim() || input.codexHomePath?.trim() || undefined;
  return {
    home,
    engineHome: input.engineHome,
    stateDir: input.stateDir,
    tmpDir: yield* SkycotFamilySandbox.scopedFamilyTempDir,
    pathEnv: input.environment.PATH,
    platform: yield* HostProcess.Platform,
    cwd: input.cwd ?? undefined,
    codexHome,
    profileId: randomFamilyProfileId(),
  };
});

export type CodexFilesystemAccess = "read" | "write" | "none";

/** A path SKYCOT can't write as a Codex glob safely: the profile is not built (fail closed). */
export class FamilyCodexPathError extends Error {}

/** Characters with a meaning in Codex's globs, written as a one-character class instead. */
const GLOB_SPECIAL = /[*?[{}]/g;
/** Characters SKYCOT does not try to write in a glob at all. */
const GLOB_REFUSED = /[\]\\]/;
/**
 * Only plain ASCII (letters, digits, space and printable punctuation) is ever written in a glob.
 * macOS's sandbox folds accented and other non-ASCII letters its own way (pre-release review B1,
 * checked live with codex-cli 0.160.1: with the project `Projects/élan`, the globs meant to close
 * its siblings let `eve/`, `elan2/` and `ève/` be read). A name with any other character next to
 * the project, the toolchains or the temporary folder, or on the way down to them, is not
 * written at all: the profile is not built and Codex does not start (fail closed).
 */
const GLOB_SAFE = /^[\x20-\x7E]*$/;
/** Characters that stand for themselves inside a class (checked live, codex-cli 0.160.1). */
const CLASS_PLAIN = /^[A-Za-z0-9 _]$/;

const assertGlobSafe = (text: string) => {
  if (!GLOB_SAFE.test(text)) {
    throw new FamilyCodexPathError(
      `can't write ${JSON.stringify(text)} in a glob (not plain ASCII)`,
    );
  }
  if (GLOB_REFUSED.test(text)) throw new FamilyCodexPathError(`can't write ${text} as a glob`);
};

const globLiteral = (text: string) => {
  assertGlobSafe(text);
  return text.replace(GLOB_SPECIAL, (char) => `[${char}]`);
};

/**
 * "Any one character except these, and never a folder separator". macOS's sandbox reads a
 * class its own way, so only the forms checked live are written: ASCII letters, digits, space and
 * `_` as themselves, `-` first, `.` as the range `.-/` (which also covers `/`), anything else as
 * a one-character range. `-` and `.` together have no form that works: refused.
 */
const notOneOf = (chars: ReadonlySet<string>) => {
  if (chars.has("-") && chars.has(".")) {
    throw new FamilyCodexPathError("names that go on with both - and . at the same place");
  }
  const members = [...chars]
    .filter((char) => char !== "-" && char !== ".")
    .sort()
    .map((char) => {
      assertGlobSafe(char);
      return CLASS_PLAIN.test(char) ? char : `${char}-${char}`;
    });
  return `[!${chars.has("-") ? "-" : ""}${members.join("")}${chars.has(".") ? ".-/" : "/"}]`;
};

/**
 * A name as a glob that matches only itself: one plain character written as a class, so that
 * Codex reads it as a glob (case-insensitive) rather than as a path.
 */
const asGlob = (text: string) => {
  const chars = Array.from(text);
  const at = chars.findIndex((char) => CLASS_PLAIN.test(char) || char === ".");
  if (at < 0) return globLiteral(text);
  return [
    globLiteral(chars.slice(0, at).join("")),
    `[${chars[at]}]`,
    globLiteral(chars.slice(at + 1).join("")),
  ].join("");
};

/**
 * Pure: globs that match every name in `folder` except `keep`, and everything inside each of
 * those, now and for names made later. Codex applies a glob like a macOS sandbox pattern, at
 * the moment of each file access, so a file saved next to the project after the conversation
 * started is covered too; it compares names without regard to case, as the Mac's disk does, so
 * the names are compared in lower case here. Built from the names' shared beginnings: for each
 * beginning `p`, a name that goes on with any other character (`p[!xy/]**`), a name that is
 * exactly `p` when `p` is not kept, and a longer name after a kept one
 * (`p[!/]**`).
 */
export function everyOtherName(folder: string, keep: ReadonlySet<string>): Array<string> {
  // Before lower-casing: an accent must never reach a glob, whatever toLowerCase makes of it.
  assertGlobSafe(folder);
  for (const name of keep) assertGlobSafe(name);
  const kept = new Set([...keep].map((name) => name.toLowerCase()));
  const names = [...kept].map((name) => Array.from(name));
  const prefixes = new Map<string, Array<string>>();
  for (const name of names) {
    for (let length = 0; length <= name.length; length += 1) {
      prefixes.set(name.slice(0, length).join(""), name.slice(0, length));
    }
  }
  const base = folder === "/" ? "" : globLiteral(folder);
  const patterns: Array<string> = [];
  for (const [text, chars] of prefixes) {
    const next = new Set(
      names
        .filter(
          (name) => name.length > chars.length && name.slice(0, chars.length).join("") === text,
        )
        .map((name) => name[chars.length]!),
    );
    const literal = globLiteral(text);
    // The name and everything inside it, in one glob (`**` after the class goes on past `/`):
    // macOS compiles all of them into one rule set with a size limit.
    patterns.push(`${base}/${literal}${next.size === 0 ? "[!/]" : notOneOf(next)}**`);
    // "." and ".." are not names in a folder: written out they would close the folder itself.
    if (text.length > 0 && text !== "." && text !== ".." && !kept.has(text)) {
      // Exactly this name, as a glob so that it is compared without regard to case too.
      const exact = `${base}/${asGlob(text)}`;
      patterns.push(exact, `${exact}/**`);
    }
  }
  return patterns;
}

/**
 * Pure: SkycotFamilySandbox's rules as a Codex profile's `filesystem` table. Codex applies the
 * most exact path; its globs are applied after everything else. One difference from the macOS
 * profile SKYCOT writes itself: Codex has no "may look a name up but not read it" rule, and a
 * program that resolves its own folder (Node does, for every script) must look up each folder
 * above it. So an unreadable folder that holds the project, a toolchain or the temporary folder
 * is not closed as a whole: the folders on the way down stay readable as folders (their names
 * and listing), and everything else in them is closed by `everyOtherName`. Every other
 * unreadable place is closed as a whole. Then read again, writable, and the never-writable
 * places (still readable where they were, e.g. the project's `.git`).
 */
export function familyCodexFilesystem(
  filesystem: SkycotFamilySandbox.FamilyFilesystem,
): Record<string, CodexFilesystemAccess> {
  const needed = [...new Set([...filesystem.allowRead, ...filesystem.allowWrite])];
  const isWithin = SkycotFamilySandbox.isWithin;
  /** What the rules say about one path, most exact rule first (before any folder is opened). */
  const access = (path: string): CodexFilesystemAccess => {
    let best: { readonly length: number; readonly access: CodexFilesystemAccess } | undefined;
    const consider = (rules: ReadonlyArray<string>, value: CodexFilesystemAccess) => {
      for (const rule of rules) {
        if (isWithin(rule, path) && (best === undefined || rule.length >= best.length)) {
          best = { length: rule.length, access: value };
        }
      }
    };
    consider(filesystem.denyRead, "none");
    consider(filesystem.allowRead, "read");
    consider(filesystem.allowWrite, "write");
    return best?.access ?? "read";
  };

  const table = new Map<string, CodexFilesystemAccess>([[":root", "read"]]);
  const globs = new Set<string>();
  const holdsNeeded = (path: string) =>
    needed.some((target) => target !== path && isWithin(path, target));
  for (const denied of filesystem.denyRead) {
    if (!holdsNeeded(denied)) {
      table.set(denied, "none");
      continue;
    }
    // Walk down from the unreadable folder to each place inside it that is needed.
    const below = needed.filter((target) => target !== denied && isWithin(denied, target));
    const folders = new Map<string, Set<string>>();
    for (const target of below) {
      let folder = denied;
      for (const name of NodePath.relative(denied, target).split(NodePath.sep)) {
        const keep = folders.get(folder) ?? new Set<string>();
        keep.add(name);
        folders.set(folder, keep);
        folder = NodePath.join(folder, name);
        if (needed.includes(folder)) break;
      }
    }
    for (const [folder, keep] of folders) {
      for (const glob of everyOtherName(folder, keep)) globs.add(glob);
    }
  }
  for (const path of filesystem.allowRead) table.set(path, "read");
  for (const path of filesystem.allowWrite) table.set(path, "write");
  for (const path of filesystem.denyWrite) {
    table.set(path, access(path) === "none" ? "none" : "read");
  }
  for (const glob of globs) table.set(glob, "none");
  return Object.fromEntries(table);
}

/** Pure: a Codex permission profile from the Family rules; never any internet. */
export function familyCodexProfile(
  filesystem: SkycotFamilySandbox.FamilyFilesystem,
  description: string,
): Record<string, Schema.Json> {
  return {
    description,
    filesystem: familyCodexFilesystem(filesystem),
    network: { enabled: false },
  };
}

/**
 * The environment a child's commands run with: only the names SkycotFamilySandbox allows
 * (whatever the engine or the grown-up's shell set), git without the grown-up's config, and the
 * session's own temporary folder.
 */
export function familyCodexShellEnvironment(
  tmpDir: string | undefined,
): Record<string, Schema.Json> {
  return {
    inherit: "all",
    include_only: [...SkycotFamilySandbox.FAMILY_CHILD_ENV_PATTERNS],
    set: {
      ...SkycotFamilySandbox.FAMILY_GIT_ENV,
      ...(tmpDir === undefined ? {} : { TMPDIR: tmpDir }),
    },
  };
}

const sandboxFilesystem = (
  places: FamilyCodexPlaces,
  cwd: string | undefined,
): SkycotFamilySandbox.FamilyFilesystem => {
  const filesystem = SkycotFamilySandbox.familyFilesystem({
    home: places.home,
    engineHome: places.engineHome,
    stateDir: places.stateDir,
    cwd,
    tmpDir: cwd === undefined ? undefined : places.tmpDir,
    pathEnv: places.pathEnv,
    platform: places.platform,
    uid: places.uid,
  });
  if (places.codexHome === undefined) return filesystem;
  const codexHome = [places.codexHome, SkycotFamilySandbox.realOrSelf(places.codexHome)];
  return {
    ...filesystem,
    denyRead: [...new Set([...filesystem.denyRead, ...codexHome])],
    denyWrite: [...new Set([...filesystem.denyWrite, ...codexHome])],
  };
};

/** Config for one child's thread in `cwd` (keys in Codex's dotted `config` form). */
export function familyCodexThreadContainment(
  places: FamilyCodexPlaces,
  cwd: string,
): Record<string, Schema.Json> {
  const id = familyProfileIds(places).thread;
  return {
    [`permissions.${id}`]: familyCodexProfile(
      sandboxFilesystem(places, cwd),
      "SKYCOT Family: this project only",
    ),
    default_permissions: id,
    shell_environment_policy: familyCodexShellEnvironment(places.tmpDir),
  };
}

/** Config for the child's Codex process: the base profile as its default. */
export function familyCodexBaseContainment(places: FamilyCodexPlaces): Record<string, Schema.Json> {
  const id = familyProfileIds(places).base;
  return {
    [`permissions.${id}`]: familyCodexProfile(
      sandboxFilesystem(places, undefined),
      "SKYCOT Family: no project",
    ),
    default_permissions: id,
    shell_environment_policy: familyCodexShellEnvironment(undefined),
  };
}

/** Pure: a JSON value as a TOML inline value (what `-c key=value` parses). */
export function tomlInline(value: Schema.Json): string {
  if (value === null) throw new Error("TOML has no null");
  if (Array.isArray(value)) return `[${value.map(tomlInline).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}=${tomlInline(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One launch-argument token, quoted for `tokenizeCliArgs` (shell-style single quotes). */
const quoteLaunchArg = (arg: string) => `'${arg.replaceAll("'", `'"'"'`)}'`;

/** The base containment as `-c` launch tokens, quoted for the launch-argument string. */
export function familyCodexBaseLaunchArgs(places: FamilyCodexPlaces): ReadonlyArray<string> {
  return Object.entries(familyCodexBaseContainment(places)).flatMap(([key, value]) => [
    "-c",
    quoteLaunchArg(`${key}=${tomlInline(value)}`),
  ]);
}

/**
 * The base profile's launch arguments; none when they can't be written, and the process then
 * fails its first check (`familyProcessContainmentProblem`), so every thread is refused.
 */
const baseLaunchArgsOrNone = (places: FamilyCodexPlaces | undefined): ReadonlyArray<string> => {
  if (places === undefined) return [];
  try {
    return familyCodexBaseLaunchArgs(places);
  } catch {
    return [];
  }
};

/**
 * The launch settings for a Family session's Codex process. The instance's own launch
 * arguments stay first (the environment variable wins over settings upstream, so both carry
 * the result); ours come last, so they win. Unchanged when the profile was off.
 */
export function lockLaunch<S extends { readonly launchArgs: string }>(
  lockdown: FamilyLockdown | null,
  input: { readonly settings: S; readonly environment: NodeJS.ProcessEnv },
  places?: FamilyCodexPlaces,
): { readonly settings: S; readonly environment: NodeJS.ProcessEnv } {
  if (lockdown === null) return input;
  const own = resolveCodexLaunchArgs(input.settings.launchArgs, input.environment);
  const launchArgs = [own, ...FAMILY_CODEX_LAUNCH_ARGS, ...baseLaunchArgsOrNone(places)]
    .filter((part) => part.length > 0)
    .join(" ");
  return {
    settings: { ...input.settings, launchArgs },
    environment: { ...input.environment, [T3CODE_CODEX_LAUNCH_ARGS_ENV]: launchArgs },
  };
}

/**
 * T3's text generation (`codex exec`: titles, commit messages) needs no tool, and runs in
 * Codex's read-only sandbox, which reads the whole Mac: while the profile is on it gets no
 * shell, no image viewer, no helper agents and no image generation, on top of the add-on
 * switches (the viewer and helpers are already in FAMILY_CODEX_FEATURES_OFF), and no web search.
 * Codex 0.160.1 has no switch for its file-edit tool; the read-only sandbox refuses every
 * write it would make.
 */
export const FAMILY_CODEX_TEXT_TOOLS_OFF = [
  "shell_tool",
  "unified_exec",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
  "image_generation",
] as const;

/**
 * The same switches for a one-shot `codex exec` (T3's text generation: titles, commit
 * messages), with its tools off: none while the profile was off.
 */
export function lockExecArgs(lockdown: FamilyLockdown | null): ReadonlyArray<string> {
  return lockdown === null
    ? []
    : [
        ...FAMILY_CODEX_LAUNCH_ARGS,
        ...FAMILY_CODEX_TEXT_TOOLS_OFF.flatMap((name) => ["-c", `features.${name}=false`]),
        "-c",
        `web_search="disabled"`,
      ];
}

interface SkillEntry {
  readonly path: string;
  readonly scope: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** MCP server names in a `config/read` answer. */
export function mcpServerNames(configRead: unknown): ReadonlyArray<string> {
  const config = isRecord(configRead) ? configRead.config : undefined;
  const servers = isRecord(config) ? config.mcp_servers : undefined;
  return isRecord(servers) ? Object.keys(servers) : [];
}

/** Skills in a `skills/list` answer that are not Codex's own bundled ones. */
export function nonSystemSkills(skillsList: unknown): ReadonlyArray<SkillEntry> {
  const data = isRecord(skillsList) && Array.isArray(skillsList.data) ? skillsList.data : [];
  const skills: Array<SkillEntry> = [];
  for (const entry of data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      if (!isRecord(skill) || typeof skill.path !== "string") continue;
      const scope = typeof skill.scope === "string" ? skill.scope : "unknown";
      if (scope !== "system") skills.push({ path: skill.path, scope });
    }
  }
  return skills;
}

/** Config the caller may not set for a child's thread: MCP servers and everything that sandboxes. */
const CALLER_KEYS_DROPPED = [
  "mcp_servers",
  "permissions",
  "default_permissions",
  "sandbox_mode",
  "sandbox_workspace_write",
  "shell_environment_policy",
];

/**
 * Pure: a thread's `config` with the Family overrides. Any MCP server the caller named itself is
 * dropped (none is issued in Family, F18), every server the process knows is switched off, and
 * every skill that is not Codex's own is switched off. With `containment`, the thread's
 * permission profile and command environment (`familyCodexThreadContainment`) replace whatever
 * the caller sent about sandboxing.
 */
export function familyThreadConfig(
  base: Readonly<Record<string, Schema.Json>> | undefined,
  found: { readonly mcpServers: ReadonlyArray<string>; readonly skills: ReadonlyArray<SkillEntry> },
  containment: Readonly<Record<string, Schema.Json>> = {},
): Record<string, Schema.Json> {
  const kept = Object.fromEntries(
    Object.entries(base ?? {}).filter(
      ([key]) =>
        !CALLER_KEYS_DROPPED.some((dropped) => key === dropped || key.startsWith(`${dropped}.`)),
    ),
  );
  return {
    ...kept,
    ...FAMILY_CODEX_CONFIG,
    // Nested, not dotted: a server name may itself contain a dot.
    mcp_servers: Object.fromEntries(found.mcpServers.map((name) => [name, { enabled: false }])),
    "skills.config": found.skills.map((skill) => ({ path: skill.path, enabled: false })),
    ...containment,
  };
}

/**
 * A profile as `config/read` reports it, comparable with what SKYCOT sent: Codex fills in every
 * field it knows with null (a table of nothing but nulls is then empty), and writes "none" as
 * "deny".
 */
const comparableProfile = (value: unknown): unknown => {
  if (value === "deny") return "none";
  if (Array.isArray(value)) return value.map(comparableProfile);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, comparableProfile(entry)] as const)
      .filter(
        ([, entry]) =>
          entry !== null &&
          entry !== undefined &&
          !(isRecord(entry) && Object.keys(entry).length === 0),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
};

/**
 * Pure: whether the profiles Codex reports in a `config/read` answer are exactly the ones SKYCOT
 * wrote, or null when they are. `expected` maps an id to its profile, or to `undefined` for one
 * SKYCOT has not sent yet and no other layer may name (the thread's, before the thread starts).
 * Anything another layer added, removed or changed (an `extends`, one more writable folder) is a
 * problem (review S1).
 */
export function familyProfileProblems(
  configRead: unknown,
  expected: Readonly<Record<string, Schema.Json | undefined>>,
): ReadonlyArray<string> {
  const config = isRecord(configRead) ? configRead.config : undefined;
  if (!isRecord(config)) return ["config unreadable"];
  const reported = isRecord(config.permissions) ? config.permissions : {};
  const problems: Array<string> = [];
  for (const [id, profile] of Object.entries(expected)) {
    const found = reported[id];
    if (profile === undefined) {
      if (found !== undefined) problems.push(`another config layer defines profile ${id}`);
      continue;
    }
    if (JSON.stringify(comparableProfile(found)) !== JSON.stringify(comparableProfile(profile))) {
      problems.push(`profile ${id} is not exactly the one SKYCOT wrote`);
    }
  }
  return problems;
}

/**
 * Pure: why a Family process's own default is not SKYCOT's base profile, exactly as SKYCOT wrote
 * it, or null when it is.
 */
export function familyProcessContainmentProblem(
  configRead: unknown,
  places?: FamilyCodexPlaces,
): string | null {
  const config = isRecord(configRead) ? configRead.config : undefined;
  const current = isRecord(config) ? config.default_permissions : undefined;
  const ids = familyProfileIds(places);
  if (current !== ids.base) return `default permissions are ${JSON.stringify(current ?? null)}`;
  if (places === undefined) return null;
  let base: Schema.Json;
  try {
    base = familyCodexBaseContainment(places)[`permissions.${ids.base}`]!;
  } catch (cause) {
    return String(cause);
  }
  const problems = familyProfileProblems(configRead, { [ids.base]: base, [ids.thread]: undefined });
  return problems.length === 0 ? null : problems.join("; ");
}

/** Pure: whether Codex says a thread it started, resumed or forked runs with the Family profile. */
export function threadRunsContained(
  response: unknown,
  profileId: string = FAMILY_CODEX_PROFILE,
): boolean {
  const active = isRecord(response) ? response.activePermissionProfile : undefined;
  return isRecord(active) && active.id === profileId;
}

/**
 * Pure: what is still on in a Family process, from its own answers. Empty means locked.
 */
export function familyProcessProblems(answers: {
  readonly configRead: unknown;
  readonly pluginList: unknown;
  readonly appList: unknown;
}): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const config = isRecord(answers.configRead) ? answers.configRead.config : undefined;
  const features = isRecord(config) && isRecord(config.features) ? config.features : {};
  for (const name of FAMILY_CODEX_REQUIRED_OFF) {
    if (features[name] !== false) problems.push(`feature ${name} is not off`);
  }
  const notify = isRecord(config) ? config.notify : undefined;
  if (Array.isArray(notify) ? notify.length > 0 : notify != null) {
    problems.push("notify is set");
  }
  const marketplaces =
    isRecord(answers.pluginList) && Array.isArray(answers.pluginList.marketplaces)
      ? answers.pluginList.marketplaces
      : null;
  if (marketplaces === null) problems.push("plugin list unreadable");
  for (const marketplace of marketplaces ?? []) {
    const plugins =
      isRecord(marketplace) && Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    for (const plugin of plugins) {
      if (isRecord(plugin) && plugin.enabled === true) {
        problems.push(`plugin ${String(plugin.id ?? plugin.name)} is enabled`);
      }
    }
  }
  const apps =
    isRecord(answers.appList) && Array.isArray(answers.appList.data) ? answers.appList.data : null;
  if (apps === null) problems.push("app list unreadable");
  for (const app of apps ?? []) {
    if (isRecord(app) && app.isEnabled === true) {
      problems.push(`app ${String(app.id ?? app.name)} is enabled`);
    }
  }
  return problems;
}

export const FAMILY_CODEX_REFUSAL =
  "The Family profile is on, and SKYCOT could not confirm that Codex's own add-ons on this computer (plugins, connectors, MCP servers and helper programs) are switched off, so it didn't start. Try again; if it keeps happening, a grown-up can choose Claude for this conversation or switch the Family profile off.";

/** What the child sees when Codex's safe area can't be set up (the Claude sentence, for Codex). */
export const FAMILY_CODEX_SANDBOX_REFUSAL =
  "The Family profile is on, and SKYCOT could not start Codex's safe area on this computer (it keeps Codex's commands inside the project and off the internet), so Codex didn't start. A grown-up can choose Claude for this conversation or switch the Family profile off.";

const refusal = (method: string, detail: string, message: string = FAMILY_CODEX_REFUSAL) =>
  new CodexErrors.CodexAppServerRequestError({
    code: -32_099,
    errorMessage: message,
    method,
    data: { skycotFamilyLockdown: detail },
  });

const sandboxRefusal = (method: string, detail: string) =>
  refusal(method, detail, FAMILY_CODEX_SANDBOX_REFUSAL);

const isRefusal = (error: { readonly message: string }) =>
  error.message === FAMILY_CODEX_REFUSAL || error.message === FAMILY_CODEX_SANDBOX_REFUSAL;

const THREAD_METHODS = new Set(["thread/start", "thread/resume", "thread/fork"]);
const TURN_METHODS = new Set(["turn/start", "turn/steer"]);
/**
 * The only requests a child's Codex is sent (review S3: an allow list, so a method Codex adds
 * tomorrow is refused, not forwarded). Exactly what SKYCOT's adapter sends for a conversation
 * (CodexAdapterV2, CodexThreadRevert; the test reads both files to keep this in step). The lock
 * itself reads the process's config, skills, plugins and apps directly, outside this list.
 */
export const FAMILY_CODEX_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/read",
  "thread/turns/list",
  "thread/revert",
  "thread/unarchive",
  "thread/unsubscribe",
  "thread/inject_items",
  "thread/compact/start",
  "thread/goal/get",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/terminate",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "mcpServerStatus/list",
]);
/**
 * Sent by the adapter for a grown-up, refused for a child on purpose: calling an MCP tool or
 * reading an MCP resource (no MCP server runs for a child, F18), and uploading the
 * conversation's logs to OpenAI as feedback.
 */
export const FAMILY_CODEX_REFUSED_ADAPTER_METHODS: ReadonlySet<string> = new Set([
  "mcpServer/tool/call",
  "mcpServer/resource/read",
  "feedback/upload",
]);

/**
 * Requests that set a model to work on a thread outside `turn/start`/`turn/steer` (review M2):
 * a compaction, and a goal Codex then pursues turn after turn. Like a turn, only on a confirmed
 * thread and never once an MCP server started. Pausing a goal is always allowed.
 */
const startsWork = (method: string, payload: unknown): boolean =>
  TURN_METHODS.has(method) ||
  method === "thread/compact/start" ||
  (method === "thread/goal/set" && !(isRecord(payload) && payload.status === "paused"));

type Client = CodexClient.CodexAppServerClient["Service"];

/**
 * Pure: whether a command approval asks for more than the thread's profile gives: extra folders
 * or internet for this command (`additionalPermissions`, sent by Codex versions SKYCOT's schema
 * does not know yet, so read whenever present), a host on the internet (`networkApprovalContext`)
 * or a standing rule allowing one (`proposedNetworkPolicyAmendments`). Answered no in Family,
 * before any card (review S2).
 */
export function commandApprovalAsksForMore(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const additional = payload.additionalPermissions;
  if (additional !== undefined && additional !== null) return true;
  const network = payload.networkApprovalContext;
  if (network !== undefined && network !== null) return true;
  const amendments = payload.proposedNetworkPolicyAmendments;
  return Array.isArray(amendments) && amendments.length > 0;
}

/** Family's only answer to Codex's `request_permissions`: nothing granted (review S2). */
export const FAMILY_PERMISSIONS_DECLINED = { permissions: {}, scope: "turn" } as const;
type RawRequest = (
  method: string,
  payload?: unknown,
) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>;

/** The typed client's answer, decoded as the client itself would from the raw one. */
const decodeResponse = (method: string, raw: unknown) => {
  const schema = (CodexRpc.CLIENT_REQUEST_RESPONSES as Record<string, Schema.Top | undefined>)[
    method
  ];
  if (schema === undefined) return Effect.succeed(raw);
  return Schema.decodeUnknownEffect(schema as Schema.Codec<unknown, unknown>)(raw).pipe(
    Effect.mapError((error) =>
      CodexErrors.CodexAppServerRequestError.invalidPayload(method, "decode-payload", error),
    ),
  );
};

/**
 * The Codex client of a Family session (see the header, layers 2 and 3, and Containment). The
 * same client when the profile was off when the session opened.
 */
export function lockClient(
  lockdown: FamilyLockdown | null,
  client: Client,
  places?: FamilyCodexPlaces,
): Client {
  if (lockdown === null) return client;
  const rawRequest: RawRequest = client.raw.request;
  const ids = familyProfileIds(places);
  let verified = false;
  let tainted: string | null = null;
  /** Native threads Codex confirmed run with the Family profile; only they may take a turn. */
  const contained = new Set<string>();
  const containmentUnavailable =
    places === undefined
      ? "no places"
      : places.tmpDir === undefined
        ? "no temporary folder"
        : !CONTAINED_PLATFORMS.has(places.platform)
          ? `platform ${places.platform}`
          : null;

  const verifyProcess = Effect.gen(function* () {
    if (verified) return;
    const [configRead, pluginList, appList] = yield* Effect.all([
      rawRequest("config/read", {}),
      rawRequest("plugin/list", {}),
      rawRequest("app/list", {}),
    ]);
    const problems = familyProcessProblems({ configRead, pluginList, appList });
    if (problems.length > 0) {
      yield* Effect.logError("skycot-family.codex.process-not-locked", { problems });
      return yield* refusal("thread/start", problems.join("; "));
    }
    const containment = familyProcessContainmentProblem(configRead, places);
    if (containment !== null) {
      yield* Effect.logError("skycot-family.codex.process-not-contained", { containment });
      return yield* sandboxRefusal("thread/start", containment);
    }
    // Layer 3, after the fact: an MCP server starting for a locked thread means one was missed.
    yield* client.handleServerNotification("mcpServer/startupStatus/updated", (payload) =>
      Effect.gen(function* () {
        tainted = payload.name;
        yield* Effect.logError("skycot-family.codex.mcp-server-started", {
          name: payload.name,
          threadId: payload.threadId,
        });
      }),
    );
    verified = true;
    yield* Effect.logInfo("skycot-family.codex.process-locked");
  });

  const lockThreadParams = Effect.fn("SkycotFamilyCodex.lockThreadParams")(
    function* (method: string, payload: unknown) {
      if (containmentUnavailable !== null || places === undefined) {
        yield* Effect.logError("skycot-family.codex.sandbox-unavailable", {
          method,
          reason: containmentUnavailable,
        });
        return yield* sandboxRefusal(method, containmentUnavailable ?? "no places");
      }
      yield* verifyProcess;
      const params = isRecord(payload) ? payload : {};
      const cwd = typeof params.cwd === "string" ? params.cwd : null;
      const folder = cwd ?? places.cwd ?? null;
      if (folder === null) return yield* sandboxRefusal(method, "no folder to work in");
      const [configRead, skillsList] = yield* Effect.all([
        rawRequest("config/read", cwd === null ? {} : { cwd }),
        rawRequest("skills/list", { ...(cwd === null ? {} : { cwds: [cwd] }), forceReload: true }),
      ]);
      const found = { mcpServers: mcpServerNames(configRead), skills: nonSystemSkills(skillsList) };
      yield* Effect.logInfo("skycot-family.codex.thread-locked", {
        method,
        mcpServersOff: found.mcpServers.length,
        skillsOff: found.skills.length,
      });
      const containment = yield* Effect.try({
        try: () => familyCodexThreadContainment(places, folder),
        catch: (cause) => sandboxRefusal(method, String(cause)),
      });
      // Every layer at this folder (a trusted project's own config among them) must leave the
      // base profile exactly as written and must not name the thread's (S1).
      const layered = familyProcessContainmentProblem(configRead, places);
      if (layered !== null) {
        yield* Effect.logError("skycot-family.codex.profile-changed-by-config", {
          method,
          problem: layered,
        });
        return yield* sandboxRefusal(method, layered);
      }
      const { sandbox: _legacySandbox, ...rest } = params;
      return {
        ...rest,
        permissions: ids.thread,
        config: familyThreadConfig(
          isRecord(params.config) ? (params.config as Record<string, Schema.Json>) : undefined,
          found,
          containment,
        ),
      };
    },
    (effect, method) =>
      effect.pipe(
        Effect.mapError((error) => (isRefusal(error) ? error : refusal(method, error.message))),
      ),
  );

  /** A thread request, sent as is (no schema strips `permissions`), then checked. */
  const startThread = Effect.fn("SkycotFamilyCodex.startThread")(function* (
    method: string,
    payload: unknown,
  ) {
    // A thread that is resumed must be confirmed again (review M3): until Codex says it runs
    // with the profile, it takes no turn, whatever it did before.
    const resumed =
      method === "thread/resume" && isRecord(payload) && typeof payload.threadId === "string"
        ? payload.threadId
        : null;
    if (resumed !== null) contained.delete(resumed);
    const locked = yield* lockThreadParams(method, payload);
    const response = yield* rawRequest(method, locked).pipe(
      // Codex checks the profile with macOS's sandbox before the thread starts (it reads
      // AGENTS.md through it): a profile the sandbox refuses is the safe area not starting.
      Effect.mapError((error) =>
        /sandbox/i.test(error.message) ? sandboxRefusal(method, error.message) : error,
      ),
    );
    const thread = isRecord(response) && isRecord(response.thread) ? response.thread : undefined;
    const threadId = typeof thread?.id === "string" ? thread.id : null;
    if (threadId === null || !threadRunsContained(response, ids.thread)) {
      if (threadId !== null) contained.delete(threadId);
      yield* Effect.logError("skycot-family.codex.thread-not-contained", {
        method,
        threadId,
        active: isRecord(response) ? (response.activePermissionProfile ?? null) : null,
      });
      return yield* sandboxRefusal(method, "Codex did not confirm the Family permission profile");
    }
    contained.add(threadId);
    return response;
  });

  /**
   * A turn (or other work, `startsWork`): only on a confirmed thread; a turn is told to use the
   * Family profile, never a sandbox policy.
   */
  const lockTurnParams = Effect.fn("SkycotFamilyCodex.lockTurnParams")(function* (
    method: string,
    payload: unknown,
  ) {
    const params: Record<string, unknown> = isRecord(payload) ? payload : {};
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    if (threadId === null || !contained.has(threadId)) {
      yield* Effect.logError("skycot-family.codex.turn-on-uncontained-thread", {
        method,
        threadId,
      });
      return yield* sandboxRefusal(method, "thread not confirmed contained");
    }
    if (method !== "turn/start") return params;
    const { sandboxPolicy: _legacySandboxPolicy, ...rest } = params;
    return { ...rest, permissions: ids.thread };
  });

  const intercept = (method: string, payload: unknown, typed: boolean) => {
    if (!FAMILY_CODEX_ALLOWED_METHODS.has(method)) {
      return Effect.logWarning("skycot-family.codex.blocked-request", { method }).pipe(
        Effect.andThen(Effect.fail(refusal(method, "not allowed while the Family profile is on"))),
      );
    }
    if ((startsWork(method, payload) || THREAD_METHODS.has(method)) && tainted !== null) {
      return Effect.fail(refusal(method, `MCP server ${tainted} started`));
    }
    const answer = (raw: unknown) => (typed ? decodeResponse(method, raw) : Effect.succeed(raw));
    if (THREAD_METHODS.has(method)) {
      return startThread(method, payload).pipe(Effect.flatMap(answer));
    }
    if (startsWork(method, payload)) {
      return lockTurnParams(method, payload).pipe(
        Effect.flatMap((locked) => rawRequest(method, locked)),
        Effect.flatMap(answer),
      );
    }
    return typed ? client.request(method as never, payload as never) : rawRequest(method, payload);
  };

  /**
   * Requests for more than the profile (review S2): `request_permissions` is answered "nothing
   * granted" without ever reaching the adapter (no card, no automatic yes on the AI's reason
   * text), and a command approval that carries extra permissions or internet is declined. The
   * features behind both are off as well (FAMILY_CODEX_FEATURES_OFF); this is the fail-closed
   * half. Every other server request reaches the adapter's handler unchanged.
   */
  const handleServerRequest = ((method: string, handler: (payload: unknown) => unknown) => {
    if (method === "item/permissions/requestApproval") {
      return client.handleServerRequest(method, ((payload: { readonly threadId?: string }) =>
        Effect.logWarning("skycot-family.codex.permissions-request-declined", {
          threadId: payload?.threadId ?? null,
        }).pipe(Effect.as(FAMILY_PERMISSIONS_DECLINED))) as never);
    }
    if (method === "item/commandExecution/requestApproval") {
      return client.handleServerRequest(method, ((payload: { readonly threadId?: string }) =>
        commandApprovalAsksForMore(payload)
          ? Effect.logWarning("skycot-family.codex.command-extra-permissions-declined", {
              threadId: payload?.threadId ?? null,
            }).pipe(Effect.as({ decision: "decline" as const }))
          : handler(payload)) as never);
    }
    return client.handleServerRequest(method as never, handler as never);
  }) as Client["handleServerRequest"];

  const raw = {
    ...client.raw,
    request: (method: string, payload?: unknown) => intercept(method, payload, false),
  };
  return {
    ...client,
    handleServerRequest,
    raw,
    request: ((method: string, payload: unknown) =>
      intercept(method, payload, true)) as Client["request"],
  };
}
