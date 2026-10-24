// @effect-diagnostics nodeBuiltinImport:off - A plain Node build step (no Effect), shared by the Effect build script.
/**
 * stage-lockfile — the packaged app installs exactly the dependency versions the repo was tested with.
 *
 * scripts/build-desktop-artifact.ts stages the app's runtime dependencies into a temporary
 * directory with a generated package.json (ranges such as `^1.2.0-beta.15`) and installs them
 * there. Without a lockfile that install took whatever was newest on build day: on 24 October 2026
 * node-pty 1.2.0-beta.18 broke the beta 3 build, and on a quieter day it would simply have shipped
 * code nobody had run. This module closes that gap in three steps (seam `skycot-stage-lockfile`):
 *
 * 1. `writeStageSeedLockfile` cuts the repo's pnpm-lock.yaml down to the staged dependencies and
 *    everything they reach, and writes it into the stage. pnpm keeps a locked version whenever the
 *    specifier still accepts it, so the stage resolves to the repo's versions.
 * 2. The build runs `vp install --lockfile-only`, which re-checks peers, overrides and the stage's
 *    own packageExtensions against that seed and writes the stage's final lockfile. Nothing is
 *    downloaded or run yet.
 * 3. `assertStageLockfileTested` compares that lockfile with the repo's: every package (name,
 *    version, tarball integrity) and every dependency link must already be in the repo lockfile. If
 *    anything is new, the build stops before any of its code is installed or run. Then the build
 *    installs with `--frozen-lockfile`, so the install is exactly the lockfile that was checked.
 *
 * Pure functions take parsed lockfiles so the tests need no network; the `*File` helpers read and
 * write the real files. `yaml` is loaded from packages/shared, the copy the build script parses YAML with (nondev/ and the repo root have none).
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

/** Step 2: resolve against the seed and write the stage's lockfile; installs nothing. */
export const STAGE_LOCKFILE_ARGS = ["install", "--lockfile-only", "--no-frozen-lockfile"] as const;
/** Step 3 appends this to the build's own install arguments. */
export const STAGE_FROZEN_INSTALL_FLAG = "--frozen-lockfile";

interface LockfileDependency {
  readonly specifier: string;
  readonly version: string;
}
type LockfileDependencies = Record<string, LockfileDependency>;
interface LockfileImporter {
  readonly dependencies?: LockfileDependencies;
  readonly optionalDependencies?: LockfileDependencies;
  readonly devDependencies?: LockfileDependencies;
}
interface LockfileSnapshot {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly [key: string]: unknown;
}
interface LockfilePackage {
  readonly resolution?: unknown;
  readonly [key: string]: unknown;
}
export interface Lockfile {
  readonly lockfileVersion: string | number;
  readonly settings?: Record<string, unknown>;
  readonly importers?: Record<string, LockfileImporter>;
  readonly packages?: Record<string, LockfilePackage>;
  readonly snapshots?: Record<string, LockfileSnapshot>;
  readonly [key: string]: unknown;
}

export interface StageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/** `node-pty@1.2.0-beta.15(patch_hash=…)` → `node-pty@1.2.0-beta.15` (the packages: key). */
export function packageKeyOf(snapshotKey: string): string {
  const open = snapshotKey.indexOf("(");
  return open === -1 ? snapshotKey : snapshotKey.slice(0, open);
}

/**
 * The snapshots: key a dependency reference points at, or undefined for workspace links.
 * A plain reference is a version (`4.0.5`, `1.3.1(typescript@7.0.2)`); an npm alias already names
 * its target (`@voidzero-dev/vite-plus-core@1.0.0(…)`).
 */
export function snapshotKeyOf(name: string, ref: string): string | undefined {
  if (ref.startsWith("link:")) return undefined;
  if (/^\d/.test(ref) || /^[a-z]+:/.test(ref)) return `${name}@${ref}`;
  return ref;
}

function edgesOf(snapshot: LockfileSnapshot | undefined): Array<[string, string]> {
  if (!snapshot) return [];
  return [
    ...Object.entries(snapshot.dependencies ?? {}),
    ...Object.entries(snapshot.optionalDependencies ?? {}),
  ];
}

function importerEntry(
  lockfile: Lockfile,
  importers: readonly string[],
  name: string,
): LockfileDependency | undefined {
  for (const importer of importers) {
    const entry = lockfile.importers?.[importer];
    const found =
      entry?.dependencies?.[name] ??
      entry?.optionalDependencies?.[name] ??
      entry?.devDependencies?.[name];
    if (found && !found.version.startsWith("link:")) return found;
  }
  return undefined;
}

export interface StageSeed {
  readonly lockfile: Lockfile;
  /** Staged dependency → the repo version it is seeded with. */
  readonly seeded: Record<string, string>;
  /** Staged dependencies the repo lockfile does not hold; the check in step 3 decides. */
  readonly unseeded: readonly string[];
}

/**
 * Step 1. `importers` are the repo workspaces whose resolutions the stage takes, first match wins
 * (the stage's package.json already merged them the same way). A staged dependency that no
 * importer declares (the per-platform `@ff-labs/fff-bin-*` packages) is seeded when the repo
 * lockfile holds exactly the version the stage asks for.
 */
export function createStageSeedLockfile(
  repo: Lockfile,
  manifest: StageManifest,
  importers: readonly string[],
): StageSeed {
  const seeded: Record<string, string> = {};
  const unseeded: string[] = [];
  const roots: string[] = [];

  const seedGroup = (dependencies: Record<string, string> | undefined) => {
    const group: LockfileDependencies = {};
    for (const [name, specifier] of Object.entries(dependencies ?? {})) {
      const entry = importerEntry(repo, importers, name);
      let version: string | undefined;
      if (entry) {
        version = entry.version;
      } else if (repo.snapshots && Object.hasOwn(repo.snapshots, `${name}@${specifier}`)) {
        version = specifier;
      }
      const key = version === undefined ? undefined : snapshotKeyOf(name, version);
      if (version === undefined || key === undefined || !repo.snapshots?.[key]) {
        unseeded.push(name);
        continue;
      }
      // The specifier is the stage's own, so pnpm treats the entry as current and keeps it.
      group[name] = { specifier, version };
      seeded[name] = packageKeyOf(key).slice(packageKeyOf(key).lastIndexOf("@") + 1);
      roots.push(key);
    }
    return group;
  };

  const dependencies = seedGroup(manifest.dependencies);
  const devDependencies = seedGroup(manifest.devDependencies);

  const snapshots: Record<string, LockfileSnapshot> = {};
  const packages: Record<string, LockfilePackage> = {};
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (Object.hasOwn(snapshots, key)) continue;
    const snapshot = repo.snapshots?.[key];
    if (!snapshot) continue;
    snapshots[key] = snapshot;
    const packageKey = packageKeyOf(key);
    const pkg = repo.packages?.[packageKey];
    if (pkg) packages[packageKey] = pkg;
    for (const [name, ref] of edgesOf(snapshot)) {
      const child = snapshotKeyOf(name, ref);
      if (child !== undefined) queue.push(child);
    }
  }

  const importer: Record<string, LockfileDependencies> = {};
  if (Object.keys(dependencies).length > 0) importer.dependencies = dependencies;
  if (Object.keys(devDependencies).length > 0) importer.devDependencies = devDependencies;

  return {
    lockfile: {
      lockfileVersion: repo.lockfileVersion,
      ...(repo.settings ? { settings: repo.settings } : {}),
      importers: { ".": importer },
      packages: sortKeys(packages),
      snapshots: sortKeys(snapshots),
    },
    seeded,
    unseeded: unseeded.sort(),
  };
}

export interface UntestedStageEntry {
  /** `name@version`, or `name@version > dep@version` for a dependency link. */
  readonly entry: string;
  readonly reason: "new-package" | "different-tarball" | "new-link" | "different-direct-version";
}

/**
 * Step 3. Every package in the stage lockfile must be in the repo lockfile with the same tarball,
 * every dependency link (`a@1 > b@2`) must exist somewhere in the repo's tree, and every staged
 * dependency the repo declares must sit at the repo's version. Links the repo has and the stage
 * lacks are fine (an optional peer the stage leaves out, a platform package it skips).
 */
export function findUntestedStageEntries(
  repo: Lockfile,
  stage: Lockfile,
  seededDirect: Record<string, string> = {},
): UntestedStageEntry[] {
  const untested: UntestedStageEntry[] = [];

  for (const [key, pkg] of Object.entries(stage.packages ?? {})) {
    const tested = repo.packages?.[key];
    if (!tested) {
      untested.push({ entry: key, reason: "new-package" });
    } else if (JSON.stringify(tested.resolution) !== JSON.stringify(pkg.resolution)) {
      untested.push({ entry: key, reason: "different-tarball" });
    }
  }

  const repoLinks = new Set<string>();
  for (const [key, snapshot] of Object.entries(repo.snapshots ?? {})) {
    for (const [name, ref] of edgesOf(snapshot)) {
      const child = snapshotKeyOf(name, ref);
      if (child !== undefined) repoLinks.add(`${packageKeyOf(key)} > ${packageKeyOf(child)}`);
    }
  }
  for (const [key, snapshot] of Object.entries(stage.snapshots ?? {})) {
    for (const [name, ref] of edgesOf(snapshot)) {
      const child = snapshotKeyOf(name, ref);
      if (child === undefined) continue;
      const link = `${packageKeyOf(key)} > ${packageKeyOf(child)}`;
      if (!repoLinks.has(link)) untested.push({ entry: link, reason: "new-link" });
    }
  }

  const stageImporter = stage.importers?.["."];
  for (const group of [stageImporter?.dependencies, stageImporter?.devDependencies]) {
    for (const [name, { version }] of Object.entries(group ?? {})) {
      const expected = seededDirect[name];
      const key = snapshotKeyOf(name, version);
      if (expected === undefined || key === undefined) continue;
      const actual = packageKeyOf(key);
      if (actual.slice(actual.lastIndexOf("@") + 1) !== expected) {
        untested.push({
          entry: `${name}@${expected} -> ${actual}`,
          reason: "different-direct-version",
        });
      }
    }
  }

  return untested.sort((a, b) => a.entry.localeCompare(b.entry));
}

export class UntestedStageDependenciesError extends Error {
  readonly untested: readonly UntestedStageEntry[];
  constructor(untested: readonly UntestedStageEntry[]) {
    const shown = untested.slice(0, 40).map((item) => `  ${item.entry} (${item.reason})`);
    const more =
      untested.length > shown.length ? [`  … and ${untested.length - shown.length} more`] : [];
    super(
      [
        `The staged install would ship ${untested.length} dependency entr${untested.length === 1 ? "y" : "ies"} the repo's pnpm-lock.yaml does not hold, so they were never tested:`,
        ...shown,
        ...more,
        "Run `pnpm install` in the repo (so the lockfile and the tests see the change), then build again.",
      ].join("\n"),
    );
    this.name = "UntestedStageDependenciesError";
    this.untested = untested;
  }
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

type YamlModule = {
  parse: (source: string, options?: Record<string, unknown>) => unknown;
  stringify: (value: unknown, options?: Record<string, unknown>) => string;
};

function loadYaml(repoRoot: string): YamlModule {
  return NodeModule.createRequire(NodePath.join(repoRoot, "packages", "shared", "package.json"))(
    "yaml",
  ) as YamlModule;
}

export function readLockfile(repoRoot: string, lockfilePath: string): Lockfile {
  return loadYaml(repoRoot).parse(NodeFS.readFileSync(lockfilePath, "utf8"), {
    maxAliasCount: -1,
  }) as Lockfile;
}

/** Step 1 on disk: reads the stage's package.json, writes its pnpm-lock.yaml. */
export function writeStageSeedLockfile(input: {
  readonly repoRoot: string;
  readonly stageDir: string;
  readonly importers: readonly string[];
}): StageSeed {
  const repo = readLockfile(input.repoRoot, NodePath.join(input.repoRoot, "pnpm-lock.yaml"));
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(input.stageDir, "package.json"), "utf8"),
  ) as StageManifest;
  const seed = createStageSeedLockfile(repo, manifest, input.importers);
  NodeFS.writeFileSync(
    NodePath.join(input.stageDir, "pnpm-lock.yaml"),
    loadYaml(input.repoRoot).stringify(seed.lockfile, { lineWidth: 0 }),
  );
  return seed;
}

/** Step 3 on disk: throws UntestedStageDependenciesError when the stage left the tested tree. */
export function assertStageLockfileTested(input: {
  readonly repoRoot: string;
  readonly stageDir: string;
  /** `StageSeed.seeded` from step 1: the direct versions the stage was promised. */
  readonly seeded: Record<string, string>;
}): { readonly packageCount: number } {
  const repo = readLockfile(input.repoRoot, NodePath.join(input.repoRoot, "pnpm-lock.yaml"));
  const stage = readLockfile(input.repoRoot, NodePath.join(input.stageDir, "pnpm-lock.yaml"));
  const untested = findUntestedStageEntries(repo, stage, input.seeded);
  if (untested.length > 0) throw new UntestedStageDependenciesError(untested);
  return { packageCount: Object.keys(stage.packages ?? {}).length };
}
