// @effect-diagnostics nodeBuiltinImport:off
// Installed add-ons and tool caches stay out of a folder's versions.
//
// First principles: a version is what the child (or the assistant for them) made. An add-on
// installed into `node_modules` is thousands of files nobody wrote, that the install can make
// again from `package.json` at any time; counting it made "What changed" say "Changed 1269
// files" for a turn that wrote 3 (live test, 24 October 2026).
//
// So SKYCOT lists those folders in the repository's own `.git/info/exclude`: Git honours it
// exactly like a `.gitignore` (the engine's checkpoints stage with `git add -A`, which skips
// excluded paths, and Undo's `git clean -fd` leaves them alone), but it lives inside `.git`,
// so the child never sees it and it is never committed or shared. Nothing is written into
// the child's own project.
//
// Two callers: keepVersions, right after it starts versions in a new question's folder; and
// the approved-installs step, just before it installs, so a folder made before this existed
// (or a named project) gets it too.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

/** What never counts as something made: installed add-ons and tool caches. */
export const KEEP_OUT_OF_VERSIONS: ReadonlyArray<string> = [
  "node_modules/",
  "bower_components/",
  ".pnpm-store/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".DS_Store",
];

const HEADER = "# SKYCOT: installed add-ons and tool caches are not part of the versions.";

/**
 * The exclude file with SKYCOT's lines added, keeping everything already there; null when
 * every line is already in it. Pure, so the rule can be read and tested on its own.
 */
export function withKeptOut(existing: string): string | null {
  const present = new Set(existing.split(/\r?\n/u).map((line) => line.trim()));
  const missing = KEEP_OUT_OF_VERSIONS.filter((pattern) => !present.has(pattern));
  if (missing.length === 0) return null;
  const lines = [...(present.has(HEADER) ? [] : [HEADER]), ...missing];
  const base = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}${lines.join("\n")}\n`;
}

/** Runs `git <args>` in the folder, a non-zero exit included; exitCode null when unknown. */
export type RunGit = (
  args: ReadonlyArray<string>,
) => Effect.Effect<{ readonly exitCode: number | null; readonly stdout: string }, Error>;

export type KeepOutcome = "added" | "already" | "not-a-repo" | "failed";

/**
 * Adds SKYCOT's lines to the exclude file of the Git repository at `folder`. With
 * `unlessIgnored`, a repository that already ignores `node_modules` (its own `.gitignore`,
 * say) is left exactly as it is. Never fails: without it versions still work, only noisier.
 */
export const keepAddOnsOutOfVersions: (
  runGit: RunGit,
  folder: string,
  options?: { readonly unlessIgnored?: boolean },
) => Effect.Effect<KeepOutcome> = Effect.fn("SkycotKeepOutOfVersions.keepAddOnsOutOfVersions")(
  function* (runGit: RunGit, folder: string, options: { readonly unlessIgnored?: boolean } = {}) {
    if (options.unlessIgnored === true) {
      // The trailing slash matters: without it, Git cannot tell a folder rule applies to a
      // `node_modules` that is not there yet. 0 = ignored, 1 = not, 128 = not a repository.
      const check = yield* runGit(["check-ignore", "-q", "node_modules/"]);
      if (check.exitCode === 0) return "already" as const;
      if (check.exitCode !== 1) return "not-a-repo" as const;
    }
    const where = yield* runGit([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "info/exclude",
    ]);
    const excludePath = where.stdout.trim();
    if (where.exitCode !== 0 || excludePath.length === 0) return "not-a-repo" as const;
    const file = NodePath.resolve(folder, excludePath);
    const next = yield* Effect.tryPromise(async () => {
      const existing = await NodeFSP.readFile(file, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      const content = withKeptOut(existing);
      if (content === null) return null;
      await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
      await NodeFSP.writeFile(file, content, "utf8");
      return content;
    });
    return next === null ? ("already" as const) : ("added" as const);
  },
  (effect, _runGit, folder) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("skycot-versions.exclude-not-written", { folder, cause }).pipe(
          Effect.as("failed" as const),
        ),
      ),
    ),
);
