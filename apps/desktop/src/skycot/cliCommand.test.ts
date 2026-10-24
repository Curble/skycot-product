// @effect-diagnostics nodeBuiltinImport:off - Reads env.cjs and runs the rendered launcher in a real shell.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import type * as DesktopEnvironmentModule from "../app/DesktopEnvironment.ts";
import * as SkycotCliCommand from "./cliCommand.ts";

// The brand's command (24 October 2026): Advanced settings installs `skycot`, never `t3`, and
// replaces only the `t3` an older SKYCOT build installed. Upstream tests (app/DesktopCliShim and
// app/DesktopCliCommand) run with the brand unset and still see `t3`; these load the same modules
// with SKYCOT's variables set, the way nondev/brand/env.cjs sets them in the app.
const BRAND = { T3CODE_APP_BASE_NAME: "SKYCOT", T3CODE_CLI_NAME: "skycot" };

const brandEnvNames = () => {
  const require = NodeModule.createRequire(import.meta.url);
  vi.stubEnv("T3CODE_BRAND_ENV_SKIP", "1");
  const envModule = require("../../../../nondev/brand/env.cjs") as {
    brand: unknown;
    resolveBrandEnv: (brand: unknown, host: { homedir: string }) => Record<string, string>;
  };
  return Object.keys(envModule.resolveBrandEnv(envModule.brand, { homedir: "/home/someone" }));
};

/** env.cjs variables the installed command does not need: the app's home, build and window. */
const NOT_FOR_THE_COMMAND = new Set([
  "T3CODE_HOME",
  "T3CODE_DESKTOP_APP_ID",
  "T3CODE_DESKTOP_APP_USER_MODEL_ID",
  "T3CODE_DESKTOP_PACKAGE_NAME",
  "T3CODE_DESKTOP_USER_DATA_DIR",
  "T3CODE_DESKTOP_CLIENT_ENTRY",
  "T3CODE_DESKTOP_UPDATE_REPOSITORY",
  "T3CODE_DESKTOP_COPYRIGHT",
  "T3CODE_DESKTOP_ARTIFACT_NAME",
  "T3CODE_DESKTOP_ICON_MAC_PNG",
  "T3CODE_DESKTOP_ICON_MAC_ICNS",
  "T3CODE_DESKTOP_ICON_LINUX_PNG",
  "T3CODE_DESKTOP_ICON_WIN_ICO",
  "T3CODE_DESKTOP_DMG_BACKGROUND_SVG",
]);

const loadBranded = async () => {
  for (const [name, value] of Object.entries(BRAND)) vi.stubEnv(name, value);
  vi.resetModules();
  const shim = await import("../app/DesktopCliShim.ts");
  const command = await import("../app/DesktopCliCommand.ts");
  const environment = await import("../app/DesktopEnvironment.ts");
  return { shim, command, environment };
};

const machinePath = process.env.PATH;
beforeEach(() => {
  process.env.PATH = "";
});
afterEach(() => {
  process.env.PATH = machinePath;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SKYCOT's command-line tool", () => {
  it("carries every brand variable the command needs, and nothing env.cjs leaves unsorted", () => {
    const names = brandEnvNames();
    for (const name of SkycotCliCommand.LAUNCHER_ENV_NAMES) expect(names).toContain(name);
    const unsorted = names.filter(
      (name) =>
        !NOT_FOR_THE_COMMAND.has(name) &&
        !(SkycotCliCommand.LAUNCHER_ENV_NAMES as ReadonlyArray<string>).includes(name),
    );
    expect(unsorted).toEqual([]);
    expect(names).toContain("T3CODE_CLI_NAME");
  });

  it("names the launcher skycot and marks it as SKYCOT's", async () => {
    const { shim } = await loadBranded();
    expect(shim.MARKER).toBe("Written by SKYCOT: runs the desktop app's bundled skycot CLI.");
    expect(shim.MARKER).not.toBe(SkycotCliCommand.UPSTREAM_MARKER);
    const environment = {
      path: NodePath,
      platform: "darwin",
      baseDir: "/Users/me/.skycot",
    } as unknown as DesktopEnvironmentModule.DesktopEnvironment["Service"];
    expect(shim.launcherPath(environment)).toBe("/Users/me/.skycot/bin/skycot");
  });

  it("the launcher hands SKYCOT's variables to the CLI, and the person's own still win", async () => {
    const { shim } = await loadBranded();
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-cli-shim-"));
    try {
      const app = NodePath.join(root, "SKYCOT");
      NodeFS.writeFileSync(
        app,
        '#!/bin/sh\necho "name=$T3CODE_APP_BASE_NAME cli=$T3CODE_CLI_NAME home=$T3CODE_HOME"\n',
        { mode: 0o755 },
      );
      const launcher = NodePath.join(root, "bin", "skycot");
      NodeFS.mkdirSync(NodePath.dirname(launcher));
      NodeFS.writeFileSync(
        launcher,
        shim.renderCliShim({
          target: { kind: "direct", executable: app, entry: "/app/bin.mjs" },
          shimPath: launcher,
          t3Home: `${root}/home`,
          env: SkycotCliCommand.launcherEnv(BRAND),
        }),
        { mode: 0o755 },
      );
      const run = (env: NodeJS.ProcessEnv) =>
        NodeChildProcess.spawnSync(launcher, [], {
          encoding: "utf8",
          env: { PATH: machinePath, ...env },
        }).stdout.trim();
      expect(run({})).toBe(`name=SKYCOT cli=skycot home=${root}/home`);
      expect(run({ T3CODE_APP_BASE_NAME: "Mine" })).toBe(`name=Mine cli=skycot home=${root}/home`);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("upstream's launcher carries nothing", () => {
    expect(SkycotCliCommand.launcherEnv({ PATH: "/bin" })).toEqual([]);
  });
});

const environmentFor = (
  path: Path.Path,
  input: { home: string; baseDir: string; platform?: NodeJS.Platform },
) =>
  ({
    path,
    // Linux: the PATH folders tried are only inside the temporary home (macOS would try
    // /opt/homebrew/bin and /usr/local/bin on this machine).
    platform: input.platform ?? "linux",
    isPackaged: true,
    homeDirectory: input.home,
    baseDir: input.baseDir,
    stateDir: path.join(input.baseDir, "userdata"),
    serverRoot: "/Applications/SKYCOT.app/Contents/Resources/app.asar",
    appImagePath: Option.none(),
  }) as unknown as DesktopEnvironmentModule.DesktopEnvironment["Service"];

/** A launcher exactly as an upstream build (or SKYCOT until now) wrote it for `home`. */
const upstreamLauncher = (home: string, executable: string) =>
  [
    "#!/bin/sh",
    `# ${SkycotCliCommand.UPSTREAM_MARKER}`,
    `export T3CODE_CLI_PATH='${home}/bin/t3'`,
    `home='${home}'`,
    'export T3CODE_HOME="${T3CODE_HOME:-$home}"',
    "export ELECTRON_RUN_AS_NODE=1",
    `app='${executable}'`,
    "",
  ].join("\n");

it.layer(NodeServices.layer)("SKYCOT's Install button", (it) => {
  const setUp = Effect.fn("setUp")(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped();
    const baseDir = path.join(home, ".skycot");
    yield* fs.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
    const linkDir = path.join(home, ".local", "bin");
    yield* fs.makeDirectory(linkDir, { recursive: true });
    const modules = yield* Effect.promise(loadBranded);
    const command = yield* modules.command.make.pipe(
      Effect.provideService(
        modules.environment.DesktopEnvironment,
        environmentFor(path, { home, baseDir }),
      ),
    );
    return { fs, path, home, baseDir, linkDir, command };
  });

  it.effect("installs skycot, and never touches a real T3 Code's t3", () =>
    Effect.gen(function* () {
      const { fs, path, home, baseDir, linkDir, command } = yield* setUp();
      // T3 Code's own launcher, in T3 Code's home, linked as t3.
      const t3Launcher = path.join(home, ".t3", "bin", "t3");
      yield* fs.makeDirectory(path.dirname(t3Launcher), { recursive: true });
      yield* fs.writeFileString(t3Launcher, upstreamLauncher(path.join(home, ".t3"), "/T3"));
      yield* fs.symlink(t3Launcher, path.join(linkDir, "t3"));

      const before = yield* command.state;
      expect(before.replaces).toBeUndefined();
      const installed = yield* command.install;
      expect(installed.installedPath).toBe(path.join(linkDir, "skycot"));
      expect(yield* fs.readLink(path.join(linkDir, "skycot"))).toBe(
        path.join(baseDir, "bin", "skycot"),
      );
      expect(yield* fs.readFileString(path.join(baseDir, "bin", "skycot"))).toContain(
        "Written by SKYCOT: runs the desktop app's bundled skycot CLI.",
      );
      expect(yield* fs.exists(path.join(baseDir, "bin", "t3"))).toBe(false);
      // T3 Code's link and launcher are exactly as they were.
      expect(yield* fs.readLink(path.join(linkDir, "t3"))).toBe(t3Launcher);
      expect(yield* fs.readFileString(t3Launcher)).toBe(
        upstreamLauncher(path.join(home, ".t3"), "/T3"),
      );
      yield* command.uninstall;
      expect(yield* fs.readLink(path.join(linkDir, "t3"))).toBe(t3Launcher);
    }).pipe(Effect.scoped),
  );

  it.effect("offers to replace the t3 an older SKYCOT installed, and replaces only that", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, linkDir, command } = yield* setUp();
      const oldLauncher = path.join(baseDir, "bin", "t3");
      yield* fs.makeDirectory(path.dirname(oldLauncher), { recursive: true });
      yield* fs.writeFileString(oldLauncher, upstreamLauncher(baseDir, "/SKYCOT"));
      yield* fs.symlink(oldLauncher, path.join(linkDir, "t3"));

      const offer = yield* command.state;
      expect(offer).toMatchObject({ installedPath: null, replaces: path.join(linkDir, "t3") });
      const installed = yield* command.install;
      expect(installed.installedPath).toBe(path.join(linkDir, "skycot"));
      expect(installed.replaces).toBeUndefined();
      expect(yield* fs.exists(path.join(linkDir, "t3"))).toBe(false);
      expect(yield* fs.exists(oldLauncher)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a t3 alone that only looks like SKYCOT's", () =>
    Effect.gen(function* () {
      const { fs, path, home, baseDir, linkDir, command } = yield* setUp();
      // SKYCOT's own folder, but a launcher written for another home (not by this app).
      const oldLauncher = path.join(baseDir, "bin", "t3");
      yield* fs.makeDirectory(path.dirname(oldLauncher), { recursive: true });
      const foreign = upstreamLauncher(path.join(home, ".t3"), "/T3");
      yield* fs.writeFileString(oldLauncher, foreign);
      yield* fs.symlink(oldLauncher, path.join(linkDir, "t3"));

      expect((yield* command.state).replaces).toBeUndefined();
      yield* command.install;
      expect(yield* fs.readLink(path.join(linkDir, "t3"))).toBe(oldLauncher);
      expect(yield* fs.readFileString(oldLauncher)).toBe(foreign);
    }).pipe(Effect.scoped),
  );
});
