#!/usr/bin/env node
/**
 * stage-install-dry-run — runs only the release build's dependency staging and install, into a
 * temporary directory, and prints the installed versions beside the repo lockfile's. Nothing is
 * built, signed, notarised or packaged; the repo is only read.
 *
 *   node nondev/scripts/stage-install-dry-run.ts [--platform mac|linux] [--arch arm64|x64|universal]
 *                                               [--out <empty dir>] [--check name,name,…]
 *
 * Defaults to --platform mac --arch arm64. macOS and Linux stages only (the Windows sidecar
 * stage is not reproduced here).
 *
 * The stage's package.json dependencies and pnpm-workspace.yaml are computed with the same
 * exported helpers scripts/build-desktop-artifact.ts uses (the release-only fields of package.json,
 * such as the electron-builder config, are left out because the install never reads them). The
 * install itself is the build's own `lockStageToRepoLockfile` followed by the same
 * `vp install --prod --frozen-lockfile`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import rootPackageJson from "../../package.json" with { type: "json" };
import desktopPackageJson from "../../apps/desktop/package.json" with { type: "json" };
import serverPackageJson from "../../apps/server/package.json" with { type: "json" };
import {
  STAGE_INSTALL_ARGS,
  createStagePatchedDependencies,
  createStageWorkspaceConfig,
  lockStageToRepoLockfile,
  pinnedPatchedDependencies,
  readWorkspaceConfig,
  resolveDesktopRuntimeDependencies,
  resolveMergedStageDependencies,
} from "../../scripts/build-desktop-artifact.ts";
import { resolveCatalogDependencies } from "../../scripts/lib/resolve-catalog.ts";
import {
  STAGE_FROZEN_INSTALL_FLAG,
  packageKeyOf,
  readLockfile,
  snapshotKeyOf,
} from "./stage-lockfile.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
// nondev/ has no node_modules of its own: load Effect from the scripts package, the same copy
// scripts/build-desktop-artifact.ts imports.
const fromScripts = NodeModule.createRequire(NodePath.join(repoRoot, "scripts", "package.json"));
const importFromScripts = (specifier: string) =>
  import(NodeURL.pathToFileURL(fromScripts.resolve(specifier)).href);
const Effect = (await importFromScripts("effect/Effect")) as typeof import("effect/Effect");
const NodeServices = (await importFromScripts(
  "@effect/platform-node/NodeServices",
)) as typeof import("@effect/platform-node/NodeServices");

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

// Defaults match the SKYCOT release (an Apple-silicon Mac DMG); pass flags for anything else.
const platform = option("platform", "mac") as "mac" | "linux";
const arch = option("arch", "arm64") as "arm64" | "x64" | "universal";
const stageDir = NodePath.resolve(
  option("out", NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-stage-dry-run-"))),
);
const checkNames = option(
  "check",
  "node-pty,effect,@napi-rs/keyring,zod,@statsig/js-client,node-addon-api,@bufbuild/protobuf",
)
  .split(",")
  .filter(Boolean);

const workspace = await Effect.runPromise(
  readWorkspaceConfig().pipe(Effect.provide(NodeServices.layer)),
);
const catalog = workspace.catalog ?? {};
const stageDependencies: Record<string, string> = resolveMergedStageDependencies({
  platform,
  serverDependencies: resolveCatalogDependencies(
    serverPackageJson.dependencies,
    catalog,
    "apps/server",
  ),
  desktopDependencies: resolveDesktopRuntimeDependencies(desktopPackageJson.dependencies, catalog),
  arch,
  fffNodeVersion: serverPackageJson.dependencies["@ff-labs/fff-node"],
});
const patched = createStagePatchedDependencies(
  workspace.patchedDependencies ?? {},
  stageDependencies,
);
Object.assign(stageDependencies, pinnedPatchedDependencies(patched));

NodeFS.mkdirSync(stageDir, { recursive: true });
if (NodeFS.readdirSync(stageDir).length > 0) {
  console.error(`${stageDir} is not empty; pass an empty --out directory.`);
  process.exit(2);
}
NodeFS.writeFileSync(
  NodePath.join(stageDir, "package.json"),
  `${JSON.stringify(
    {
      name: "skycot-stage-dry-run",
      version: "0.0.0",
      private: true,
      packageManager: rootPackageJson.packageManager,
      dependencies: stageDependencies,
      devDependencies: { electron: desktopPackageJson.dependencies.electron },
    },
    null,
    2,
  )}\n`,
);
const yaml = NodeModule.createRequire(
  NodePath.join(repoRoot, "packages", "shared", "package.json"),
)("yaml") as { stringify: (value: unknown) => string };
NodeFS.writeFileSync(
  NodePath.join(stageDir, "pnpm-workspace.yaml"),
  yaml.stringify(
    createStageWorkspaceConfig({
      platform,
      arch,
      allowBuilds: workspace.allowBuilds ?? {},
      patchedDependencies: patched,
      overrides: resolveCatalogDependencies(workspace.overrides ?? {}, catalog, "apps/desktop"),
    }),
  ),
);
if (Object.keys(patched).length > 0) {
  NodeFS.cpSync(NodePath.join(repoRoot, "patches"), NodePath.join(stageDir, "patches"), {
    recursive: true,
  });
}

console.log(
  `stage: ${stageDir} (${platform} ${arch}, ${Object.keys(stageDependencies).length} staged dependencies)`,
);
await Effect.runPromise(
  lockStageToRepoLockfile({
    repoRoot,
    stageDir,
    importers: ["apps/desktop", "apps/server"],
    label: "dry-run stage",
    verbose: false,
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
const install = NodeChildProcess.spawnSync(
  "vp",
  [...STAGE_INSTALL_ARGS, STAGE_FROZEN_INSTALL_FLAG],
  { cwd: stageDir, stdio: "inherit" },
);
if (install.status !== 0) process.exit(install.status ?? 1);

const repoLock = readLockfile(repoRoot, NodePath.join(repoRoot, "pnpm-lock.yaml"));
// What pnpm actually put in node_modules (the "current" lockfile), direct and transitive.
const installedLock = readLockfile(
  repoRoot,
  NodePath.join(stageDir, "node_modules", ".pnpm", "lock.yaml"),
);
const versionsIn = (lock: typeof repoLock, name: string): string[] =>
  Object.keys(lock.packages ?? {})
    .filter((key) => key.slice(0, key.lastIndexOf("@")) === name)
    .map((key) => key.slice(key.lastIndexOf("@") + 1))
    .sort();
const repoImporterVersion = (name: string): string | undefined => {
  for (const importer of ["apps/desktop", "apps/server"]) {
    const entry = repoLock.importers?.[importer]?.dependencies?.[name];
    const key = entry && snapshotKeyOf(name, entry.version);
    if (key) return packageKeyOf(key).slice(packageKeyOf(key).lastIndexOf("@") + 1);
  }
  return undefined;
};
let mismatches = 0;
console.log("\npackage                 staged spec   repo lockfile            installed in stage");
for (const name of checkNames) {
  const installed = versionsIn(installedLock, name);
  const direct = Object.hasOwn(stageDependencies, name);
  // A direct dependency must sit at the repo importer's version; a transitive one at a version
  // the repo lockfile holds for that package.
  const expected = direct ? [repoImporterVersion(name) ?? "?"] : versionsIn(repoLock, name);
  const ok = installed.every((version) => expected.includes(version));
  if (!ok) mismatches += 1;
  console.log(
    `${name.padEnd(23)} ${(direct ? stageDependencies[name]! : "(transitive)").padEnd(13)} ${expected.join(", ").padEnd(24)} ${installed.length > 0 ? installed.join(", ") : "(not staged)"}${ok ? "" : "   <-- NOT THE TESTED VERSION"}`,
  );
}
process.exit(mismatches === 0 ? 0 : 1);
