// The live preview inside the Family sandbox (pre-open-source review F1-R3, 3 Nov 2026).
//
// Starting a preview runs the project's own start script on this Mac, and the files it runs
// (package.json's "dev", vite.config.js, server.js…) are ones the child's assistant can write.
// The rules read the start command's words, and `"dev": "vite"` reads as ordinary work, so a
// child's yes was enough to run any code those files hold, outside every sandbox. While the
// Family profile is on, SKYCOT now starts it inside a macOS sandbox with the same rules as a
// child's commands (SkycotFamilySandbox): it reads only the project, its own temporary folder
// and the toolchains, writes only in the project (never `.git`), serves on this Mac's own
// address, has no internet, can't reach SKYCOT's engine or other programs, and gets only the
// environment variables a build needs. Where that sandbox can't start (not macOS), a script
// preview needs a grown-up (`startDecision`).
//
// The command typed into the preview's terminal stays short: it runs a start file SKYCOT writes
// into its own caches folder (`<T3 home>/caches/family-sandbox`), which neither a child's
// Claude nor Codex can write, next to the sandbox profile it uses.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Context from "effect/Context";

import {
  FAMILY_GIT_ENV,
  familySeatbeltProfile,
  isAllowedChildEnv,
  type FamilyFilesystem,
} from "../SkycotFamilySandbox.ts";

/** Whether a preview can be started inside the Family sandbox on this computer. */
export function previewSandboxAvailable(
  platform: NodeJS.Platform,
  exists: (path: string) => boolean = NodeFS.existsSync,
): boolean {
  return platform === "darwin" && exists("/usr/bin/sandbox-exec");
}

/** The check SkycotPreview uses; tests set it to say what this computer can do. */
export const PreviewSandboxCheck = Context.Reference<(platform: NodeJS.Platform) => boolean>(
  "t3/skycot/preview/PreviewSandboxCheck",
  { defaultValue: () => (platform) => previewSandboxAvailable(platform) },
);

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

export interface ContainedStart {
  readonly profilePath: string;
  readonly profile: string;
  readonly scriptPath: string;
  readonly script: string;
  /** What SKYCOT types into the preview's terminal (before its `; exit`). */
  readonly line: string;
}

/**
 * Pure: the sandbox profile and start file for one preview start, in SKYCOT's folder `dir`,
 * named by their contents so an unchanged start reuses them.
 */
export function containedStart(input: {
  readonly filesystem: FamilyFilesystem;
  readonly runner: string;
  readonly tmpDir: string;
  readonly port: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly folder: string;
  readonly dir: string;
}): ContainedStart {
  const profile = familySeatbeltProfile(input.filesystem, "serve-locally");
  const profilePath = NodePath.join(input.dir, `preview-${hash(profile)}.sb`);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env)) {
    if (value !== undefined && isAllowedChildEnv(name)) env[name] = value;
  }
  Object.assign(env, FAMILY_GIT_ENV, {
    TMPDIR: input.tmpDir,
    PWD: input.folder,
    BROWSER: "none",
    ...(input.port > 0 ? { PORT: String(input.port) } : {}),
  });
  const assignments = Object.entries(env)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => quote(`${name}=${value}`));
  const script = [
    "#!/bin/zsh -f",
    "# Written by SKYCOT: the live preview, inside the Family profile's sandbox.",
    `cd ${quote(input.folder)} || exit 1`,
    `exec /usr/bin/sandbox-exec -f ${quote(profilePath)} /usr/bin/env -i ${assignments.join(" ")} /bin/zsh -f -c ${quote(input.runner)}`,
    "",
  ].join("\n");
  const scriptPath = NodePath.join(input.dir, `start-${hash(script)}.sh`);
  return { profilePath, profile, scriptPath, script, line: `/bin/zsh -f ${quote(scriptPath)}` };
}

function hash(text: string): string {
  return NodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Writes the profile and start file into SKYCOT's own folder (made owner-only; a link there is
 * refused). Synchronous: called once per start, under the preview's lock.
 */
export function writeContainedStart(dir: string, start: ContainedStart): void {
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = NodeFS.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${dir} is not SKYCOT's own folder.`);
  }
  for (const [path, text] of [
    [start.profilePath, start.profile],
    [start.scriptPath, start.script],
  ] as const) {
    const temporary = `${path}.${NodeCrypto.randomBytes(6).toString("hex")}`;
    NodeFS.writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    NodeFS.renameSync(temporary, path);
  }
}
