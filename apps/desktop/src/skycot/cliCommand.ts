/**
 * SKYCOT: the command Advanced settings installs is `skycot`, never `t3`.
 *
 * Upstream's launcher (app/DesktopCliShim.ts) and its PATH link (app/DesktopCliCommand.ts) are
 * named by `CLI_COMMAND_NAME` (packages/shared cliRelease.ts, seam `brand-cli-name`), which
 * `nondev/brand/env.cjs` sets to brand.json `cliName`. Two fork rules live here:
 *
 * 1. The launcher carries the brand. It starts the app's bundled CLI without `env.cjs`, so it
 *    exports the brand variables the app itself was started with (`launcherEnv`); otherwise the
 *    installed `skycot` would print T3 Code's name, suggest `t3 …` commands and use upstream's
 *    defaults. A variable the person already set still wins. Seam `brand-cli-launcher`.
 * 2. An older SKYCOT build installed its command as `t3`, which clashes with a real T3 Code's
 *    `t3` on the same Mac. Settings offers to replace it (`replaces` in the state) and Install
 *    removes it, but only when it is SKYCOT's own: the `t3` link points at the `t3` launcher in
 *    this app's own home (`~/.skycot/bin/t3`), and that launcher carries upstream's marker and
 *    names this home. A real T3 Code's `t3` (its launcher lives in `~/.t3`) or anything else
 *    called `t3` is never read past that check, replaced or removed. Seam `brand-cli-replace-t3`.
 *
 * Upstream (no brand variables) the command is `t3`, nothing is carried and nothing is replaced.
 */
import { CLI_COMMAND_NAME } from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

/** Upstream's command name, and the marker on every launcher it (and SKYCOT until now) wrote. */
export const UPSTREAM_COMMAND = "t3";
export const UPSTREAM_MARKER = "Written by T3 Code: runs the desktop app's bundled t3 CLI.";

/** True in a branded build: the command has its own name, so an old `t3` may need replacing. */
export const isBrandedCommand = CLI_COMMAND_NAME !== UPSTREAM_COMMAND;

/**
 * Brand variables the installed command needs at run time, in `nondev/brand/env.cjs` order.
 * `T3CODE_HOME` is left out: the launcher already writes the app's home in. The rest of
 * env.cjs's variables only steer the desktop build or window (cliCommand.test.ts checks every
 * one is either here or listed as build-only there).
 */
export const LAUNCHER_ENV_NAMES = [
  "T3CODE_APP_BASE_NAME",
  "T3CODE_CLI_NAME",
  "T3CODE_DESKTOP_SCHEME",
  "T3CODE_CLIENT_ENTRY",
  "T3CODE_SKYCOT_UPDATE_FEED",
  "T3CODE_SKYCOT_MODEL_MANIFEST_URL",
  "T3CODE_CLI_UPDATE_REPOSITORY",
  "T3CODE_TELEMETRY_ENABLED",
  "T3CODE_POSTHOG_KEY",
  "T3CODE_POSTHOG_HOST",
  "T3CODE_DEFAULT_RUNTIME_MODE",
  "T3CODE_SKYCOT_POLICY",
  "T3CODE_SKYCOT_CONNECT",
  "SKYCOT_RELAY_URL",
] as const;

/** The brand variables present in `env`, as name/value pairs for the launcher to export. */
export const launcherEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlyArray<readonly [string, string]> =>
  LAUNCHER_ENV_NAMES.flatMap((name) => {
    const value = env[name];
    return value === undefined ? [] : [[name, value] as const];
  });

// The two ways DesktopCliShim.renderCliShim writes the home in (kept in step with its quoting).
const shellWord = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const cmdText = (value: string) => value.replaceAll("%", "%%");

/** Is `content` the launcher an older build of this app wrote for this home? */
export const isOwnLegacyLauncher = (content: string, home: string) =>
  content.includes(UPSTREAM_MARKER) &&
  (content.includes(`\nhome=${shellWord(home)}\n`) ||
    content.includes(`set "T3CODE_HOME=${cmdText(home)}"`));

export interface OwnLegacyCommand {
  /** The old launcher in this app's home (`<home>/bin/t3`, or `t3.cmd` on Windows). */
  readonly launcher: string;
  /** PATH links to it (macOS / Linux); on Windows the launcher's folder is on PATH itself. */
  readonly links: ReadonlyArray<string>;
  /** What Settings shows: the first link, or the launcher on Windows. */
  readonly shown: string;
}

/**
 * The `t3` an older build of this app installed, if any. Branded builds only; every check that
 * fails means "not ours" and the file is left alone.
 */
export const findOwnLegacyCommand = Effect.fn("skycot.cliCommand.findOwnLegacyCommand")(
  function* (input: {
    readonly path: Path.Path;
    readonly windows: boolean;
    readonly home: string;
    readonly binDirectory: string;
    readonly linkDirectories: ReadonlyArray<string>;
  }) {
    if (!isBrandedCommand) return undefined;
    const fs = yield* FileSystem.FileSystem;
    const launcher = input.path.join(
      input.binDirectory,
      input.windows ? `${UPSTREAM_COMMAND}.cmd` : UPSTREAM_COMMAND,
    );
    const ours = yield* Effect.gen(function* () {
      const info = yield* fs.stat(launcher);
      if (info.type !== "File" || Number(info.size) > 16_384) return false;
      return isOwnLegacyLauncher(yield* fs.readFileString(launcher), input.home);
    }).pipe(Effect.orElseSucceed(() => false));
    if (!ours) return undefined;
    if (input.windows) return { launcher, links: [], shown: launcher } satisfies OwnLegacyCommand;
    const links: Array<string> = [];
    for (const directory of input.linkDirectories) {
      const link = input.path.join(directory, UPSTREAM_COMMAND);
      const target = yield* fs.readLink(link).pipe(Effect.orElseSucceed(() => undefined));
      if (target !== undefined && input.path.resolve(directory, target) === launcher) {
        links.push(link);
      }
    }
    // A launcher nothing on PATH points at clashes with nothing: no offer, Install tidies it.
    return { launcher, links, shown: links[0] ?? launcher } satisfies OwnLegacyCommand;
  },
);

/** Removes the old command found above: its PATH links, then the launcher itself. */
export const removeOwnLegacyCommand = Effect.fn("skycot.cliCommand.removeOwnLegacyCommand")(
  function* (legacy: OwnLegacyCommand) {
    const fs = yield* FileSystem.FileSystem;
    for (const link of legacy.links) yield* fs.remove(link);
    yield* fs.remove(legacy.launcher);
  },
);
