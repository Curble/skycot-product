import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import {
  type Lockfile,
  createStageSeedLockfile,
  findUntestedStageEntries,
  packageKeyOf,
  readLockfile,
  snapshotKeyOf,
} from "./stage-lockfile.ts";

const integrity = (name: string) => ({ integrity: `sha512-${name}` });

// A small repo lockfile: the server uses node-pty (patched) and a range dependency `pty-helper`;
// the desktop uses `webauthn` with a TypeScript peer; `fff-bin` is only an optional dependency.
const repo: Lockfile = {
  lockfileVersion: "9.0",
  settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
  importers: {
    "apps/server": {
      dependencies: {
        "node-pty": { specifier: "^1.2.0-beta.15", version: "1.2.0-beta.15(patch_hash=abc)" },
        "fff-node": { specifier: "0.11.0", version: "0.11.0" },
        "@t3tools/shared": { specifier: "workspace:*", version: "link:../../packages/shared" },
      },
    },
    "apps/desktop": {
      dependencies: {
        webauthn: { specifier: "catalog:", version: "1.3.1(typescript@7.0.2)" },
        electron: { specifier: "44.4.5", version: "44.4.5" },
        vite: { specifier: "catalog:", version: "@voidzero-dev/vite-core@1.0.0" },
      },
    },
  },
  packages: {
    "node-pty@1.2.0-beta.15": { resolution: integrity("pty15") },
    "node-pty@1.2.0-beta.18": { resolution: integrity("pty18") },
    "node-addon-api@7.1.1": { resolution: integrity("naa7") },
    "fff-node@0.11.0": { resolution: integrity("fff") },
    "fff-bin@0.11.0": { resolution: integrity("fffbin") },
    "webauthn@1.3.1": { resolution: integrity("wa") },
    "webauthn-types@1.3.1": { resolution: integrity("wat") },
    "typescript@7.0.2": { resolution: integrity("ts") },
    "electron@44.4.5": { resolution: integrity("el") },
    "@voidzero-dev/vite-core@1.0.0": { resolution: integrity("vite") },
    "unrelated@1.0.0": { resolution: integrity("unrelated") },
  },
  snapshots: {
    "node-pty@1.2.0-beta.15(patch_hash=abc)": { dependencies: { "node-addon-api": "7.1.1" } },
    "node-pty@1.2.0-beta.18": { dependencies: { "node-addon-api": "7.1.1" } },
    "node-addon-api@7.1.1": {},
    "fff-node@0.11.0": { optionalDependencies: { "fff-bin": "0.11.0" } },
    "fff-bin@0.11.0": { optional: true },
    "webauthn@1.3.1(typescript@7.0.2)": {
      dependencies: { "webauthn-types": "1.3.1", typescript: "7.0.2" },
    },
    "webauthn-types@1.3.1": {},
    "typescript@7.0.2": {},
    "electron@44.4.5": {},
    "@voidzero-dev/vite-core@1.0.0": {},
    "unrelated@1.0.0": {},
  },
};

NodeTest.test("lockfile keys: peer and patch suffixes, aliases and workspace links", () => {
  NodeAssert.equal(
    packageKeyOf("node-pty@1.2.0-beta.15(patch_hash=abc)"),
    "node-pty@1.2.0-beta.15",
  );
  NodeAssert.equal(packageKeyOf("@scope/a@1.0.0(b@2.0.0(c@3.0.0))"), "@scope/a@1.0.0");
  NodeAssert.equal(
    snapshotKeyOf("webauthn", "1.3.1(typescript@7.0.2)"),
    "webauthn@1.3.1(typescript@7.0.2)",
  );
  NodeAssert.equal(
    snapshotKeyOf("vite", "@voidzero-dev/vite-core@1.0.0"),
    "@voidzero-dev/vite-core@1.0.0",
  );
  NodeAssert.equal(snapshotKeyOf("x", "link:../../packages/x"), undefined);
});

NodeTest.test(
  "the seed holds the staged dependencies at the repo's versions and nothing else",
  () => {
    const seed = createStageSeedLockfile(
      repo,
      {
        dependencies: {
          "node-pty": "1.2.0-beta.15",
          "fff-node": "0.11.0",
          "fff-bin": "0.11.0", // not declared by any importer: seeded from the exact snapshot
          webauthn: "1.3.1",
          "brand-new": "^1.0.0", // not in the repo at all: left to the check
        },
        devDependencies: { electron: "44.4.5" },
      },
      ["apps/desktop", "apps/server"],
    );

    NodeAssert.deepEqual(seed.seeded, {
      "node-pty": "1.2.0-beta.15",
      "fff-node": "0.11.0",
      "fff-bin": "0.11.0",
      webauthn: "1.3.1",
      electron: "44.4.5",
    });
    NodeAssert.deepEqual(seed.unseeded, ["brand-new"]);
    // The stage's own specifier, so pnpm treats each entry as current and keeps its version.
    NodeAssert.deepEqual(seed.lockfile.importers?.["."]?.dependencies?.["node-pty"], {
      specifier: "1.2.0-beta.15",
      version: "1.2.0-beta.15(patch_hash=abc)",
    });
    NodeAssert.deepEqual(Object.keys(seed.lockfile.packages ?? {}), [
      "electron@44.4.5",
      "fff-bin@0.11.0",
      "fff-node@0.11.0",
      "node-addon-api@7.1.1",
      "node-pty@1.2.0-beta.15",
      "typescript@7.0.2",
      "webauthn-types@1.3.1",
      "webauthn@1.3.1",
    ]);
    NodeAssert.ok(!("node-pty@1.2.0-beta.18" in (seed.lockfile.snapshots ?? {})));
    // A seed is, by construction, entirely tested.
    NodeAssert.deepEqual(findUntestedStageEntries(repo, seed.lockfile, seed.seeded), []);
  },
);

NodeTest.test("a newer release anywhere in the stage is refused (beta 3: node-pty beta.18)", () => {
  const stage: Lockfile = {
    lockfileVersion: "9.0",
    importers: {
      ".": {
        dependencies: {
          "node-pty": { specifier: "^1.2.0-beta.15", version: "1.2.0-beta.18" },
          webauthn: { specifier: "1.3.1", version: "1.3.1" },
        },
      },
    },
    packages: {
      "node-pty@1.2.0-beta.18": { resolution: integrity("pty18") },
      "node-addon-api@8.9.2": { resolution: integrity("naa8") },
      "webauthn@1.3.1": { resolution: integrity("wa-republished") },
      "webauthn-types@1.4.0": { resolution: integrity("wat14") },
    },
    snapshots: {
      "node-pty@1.2.0-beta.18": { dependencies: { "node-addon-api": "8.9.2" } },
      "node-addon-api@8.9.2": {},
      // Without the TypeScript peer (the stage makes it optional): fewer links is fine.
      "webauthn@1.3.1": { dependencies: { "webauthn-types": "1.4.0" } },
      "webauthn-types@1.4.0": {},
    },
  };
  NodeAssert.deepEqual(
    findUntestedStageEntries(repo, stage, { "node-pty": "1.2.0-beta.15", webauthn: "1.3.1" }),
    [
      { entry: "node-addon-api@8.9.2", reason: "new-package" },
      // beta.18 is in the repo lockfile (another workspace could use it), but not where the
      // stage put it: the server was tested with beta.15.
      {
        entry: "node-pty@1.2.0-beta.15 -> node-pty@1.2.0-beta.18",
        reason: "different-direct-version",
      },
      { entry: "node-pty@1.2.0-beta.18 > node-addon-api@8.9.2", reason: "new-link" },
      { entry: "webauthn-types@1.4.0", reason: "new-package" },
      { entry: "webauthn@1.3.1", reason: "different-tarball" },
      { entry: "webauthn@1.3.1 > webauthn-types@1.4.0", reason: "new-link" },
    ],
  );
});

NodeTest.test("the real repo lockfile seeds the staged app at the server's node-pty", () => {
  const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
  const lockfile = readLockfile(repoRoot, NodePath.join(repoRoot, "pnpm-lock.yaml"));
  const serverPty = lockfile.importers?.["apps/server"]?.dependencies?.["node-pty"]?.version ?? "";
  const testedPty = packageKeyOf(`node-pty@${serverPty}`).slice("node-pty@".length);
  NodeAssert.match(testedPty, /^\d+\.\d+\.\d+/);
  const seed = createStageSeedLockfile(
    lockfile,
    { dependencies: { "node-pty": `^${testedPty}`, "@napi-rs/keyring": "^1.3.0" } },
    ["apps/desktop", "apps/server"],
  );
  NodeAssert.equal(seed.seeded["node-pty"], testedPty);
  NodeAssert.deepEqual(seed.unseeded, []);
  NodeAssert.deepEqual(findUntestedStageEntries(lockfile, seed.lockfile, seed.seeded), []);
});
