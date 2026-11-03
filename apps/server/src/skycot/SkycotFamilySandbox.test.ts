// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import * as SkycotFamilySandbox from "./SkycotFamilySandbox.ts";

const home = "/Users/kid";
const project = "/Users/kid/SKYCOT/my-game";
/** A Mac where these folders exist (nothing is read from the real disk). */
const existing = new Set(["/Users/kid/.nvm", "/Users/kid/Library/pnpm", "/Users/kid/.skycot/bin"]);
const filesystem = (pathEnv: string, extra: Partial<SkycotFamilySandbox.FamilyPlaces> = {}) =>
  SkycotFamilySandbox.familyFilesystem(
    {
      home,
      engineHome: "/Users/kid/.skycot",
      stateDir: "/Users/kid/.skycot/userdata",
      cwd: project,
      tmpDir: "/private/tmp/skycot-501/AbC123",
      pathEnv,
      platform: "darwin",
      uid: 501,
      ...extra,
    },
    { realpath: (path) => path, exists: (path) => existing.has(path) },
  );

// Pre-open-source review F1-R1, F1-R4, F1-R5: reads are denied by default, and only the
// project, the conversation's temporary folder and the toolchains come back.
describe("SkycotFamilySandbox.familyFilesystem", () => {
  it("keeps the whole home, every account, external drives and shared temporary folders unreadable", () => {
    const rules = filesystem("/usr/bin:/bin");
    for (const place of [
      home,
      "/Users",
      "/Volumes",
      "/private/tmp",
      "/private/var/tmp",
      "/private/var/folders",
    ]) {
      assert.include(rules.denyRead, place);
    }
    assert.deepEqual(rules.allowRead, [
      project,
      "/private/tmp/skycot-501/AbC123",
      "/Users/kid/.nvm",
      "/Users/kid/Library/pnpm",
    ]);
    assert.deepEqual(rules.allowWrite, [project, "/private/tmp/skycot-501/AbC123"]);
  });

  it("never lets a command write the project's saved versions, SKYCOT's state or the shared Claude folder", () => {
    const rules = filesystem("/usr/bin");
    for (const place of [
      `${project}/.git`,
      "/Users/kid/.skycot/userdata",
      "/Users/kid/.skycot/caches",
      "/Users/kid/.skycot/origin-secret.txt",
      "/private/tmp/claude-501",
    ]) {
      assert.include(rules.denyWrite, place);
    }
  });

  it("reads back the installs on PATH, never a home folder, ~/.local or SKYCOT's own", () => {
    const rules = filesystem(
      [
        "/Users/kid/anaconda3/bin",
        "/Users/kid/.nvm/versions/node/v22.1.0/bin",
        "/Users/kid/.local/bin",
        "/Users/kid/.local/share/vite-plus/bin",
        "/Users/kid/bin",
        "/Users/kid/.skycot/bin",
        "/Users/other/.bun/bin",
        "relative/bin",
        "/opt/homebrew/bin",
      ].join(":"),
    );
    for (const place of [
      "/Users/kid/anaconda3",
      "/Users/kid/anaconda3/bin",
      "/Users/kid/.nvm/versions/node/v22.1.0",
      "/Users/kid/.local/bin",
      "/Users/kid/.local/share/vite-plus",
      "/Users/kid/bin",
      "/Users/other/.bun",
    ]) {
      assert.include(rules.allowRead, place);
    }
    for (const place of [
      home,
      "/Users/kid/.local",
      "/Users/kid/.local/share",
      "/Users/kid/.skycot",
      "/Users/kid/.skycot/bin",
      "/Users/other",
      "/opt/homebrew",
      "/opt/homebrew/bin",
    ]) {
      assert.notInclude(rules.allowRead, place);
    }
  });

  it("keeps the grown-up's keys unreadable inside a toolchain folder that is read again", () => {
    const rules = filesystem("/Users/kid/.cargo/bin");
    assert.include(rules.allowRead, "/Users/kid/.cargo");
    assert.include(rules.denyRead, "/Users/kid/.cargo/credentials.toml");
    const profile = SkycotFamilySandbox.familySeatbeltProfile(rules, "none");
    // The more exact rule comes last, so the key stays denied.
    const allowAt = profile.indexOf('(allow file-read* (subpath "/Users/kid/SKYCOT/my-game")');
    const nestedDeny = profile.lastIndexOf('(subpath "/Users/kid/.cargo/credentials.toml")');
    assert.isAbove(allowAt, 0);
    assert.isAbove(nestedDeny, allowAt);
  });

  it("uses Linux's own shared folders there", () => {
    const rules = filesystem("/usr/bin", {
      platform: "linux",
      home: "/home/kid",
      cwd: "/home/kid/game",
    });
    for (const place of ["/home/kid", "/home", "/tmp", "/mnt", "/media"]) {
      assert.include(rules.denyRead, place);
    }
    assert.include(rules.denyWrite, "/tmp/claude-501");
  });
});

describe("SkycotFamilySandbox environment", () => {
  it("keeps only what a build needs, whatever a secret is called", () => {
    for (const name of ["PATH", "HOME", "LANG", "LC_CTYPE", "NVM_DIR", "GIT_CONFIG_VALUE_0"]) {
      assert.isTrue(SkycotFamilySandbox.isAllowedChildEnv(name), name);
    }
    for (const name of [
      "GITHUB_TOKEN",
      "STRIPE_KEY",
      "HF_PAT",
      "SSH_AUTH_SOCK",
      "AWS_PROFILE",
      "npm_config_registry",
      "NODE_OPTIONS",
      "DATABASE_URL",
      "ANTHROPIC_BASE_URL",
    ]) {
      assert.isFalse(SkycotFamilySandbox.isAllowedChildEnv(name), name);
    }
  });
});

describe("SkycotFamilySandbox.makeFamilyTempDir", () => {
  const withRoot = (run: (root: string) => void) => {
    // Short on purpose: Claude Code needs `<dir>/claude-<uid>` within 44 bytes.
    const root = NodeFS.mkdtempSync("/tmp/s");
    try {
      run(root);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  };
  const uid = process.getuid?.() ?? 0;

  it("makes a fresh owner-only folder per conversation, short enough for Claude Code", () =>
    withRoot((root) => {
      const first = SkycotFamilySandbox.makeFamilyTempDir(uid, root);
      const second = SkycotFamilySandbox.makeFamilyTempDir(uid, root);
      assert.notEqual(first, second);
      assert.equal(NodePath.dirname(first), NodePath.join(root, `skycot-${uid}`));
      for (const dir of [NodePath.dirname(first), first]) {
        assert.equal(NodeFS.statSync(dir).mode & 0o777, 0o700, dir);
      }
      assert.isAtMost(Buffer.byteLength(NodePath.join(first, `claude-${uid}`)), 44);
    }));

  it("refuses a base folder someone else planted as a link, or a path too long", () =>
    withRoot((root) => {
      const elsewhere = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "elsewhere-"));
      try {
        NodeFS.symlinkSync(elsewhere, NodePath.join(root, `skycot-${uid}`));
        assert.throws(() => SkycotFamilySandbox.makeFamilyTempDir(uid, root));
      } finally {
        NodeFS.rmSync(elsewhere, { recursive: true, force: true });
      }
      const deep = NodePath.join(root, "a-folder-name-long-enough-to-pass-the-limit");
      NodeFS.mkdirSync(deep);
      assert.throws(() => SkycotFamilySandbox.makeFamilyTempDir(uid, deep), /too long/);
      assert.deepEqual(NodeFS.readdirSync(NodePath.join(deep, `skycot-${uid}`)), []);
    }));
});

describe("SkycotFamilySandbox.familySeatbeltProfile", () => {
  it("denies by default and allows only serving on this Mac's own address", () => {
    const rules = filesystem("/usr/bin");
    const profile = SkycotFamilySandbox.familySeatbeltProfile(rules, "serve-locally");
    assert.isTrue(profile.startsWith("(version 1)\n(deny default)\n"));
    assert.include(profile, '(allow network-inbound (local ip "localhost:*"))');
    assert.notInclude(profile, "network-outbound");
    assert.notInclude(profile, "appleevent");
    assert.notInclude(SkycotFamilySandbox.familySeatbeltProfile(rules, "none"), "network-");
    const order = [
      "(allow file-read*)",
      '(deny file-read* (subpath "/Users/kid")',
      `(allow file-read* (subpath "${project}")`,
      "(allow file-read-metadata)",
      `(allow file-write* (subpath "${project}")`,
      `(deny file-write* (subpath "/Users/kid/.skycot/userdata")`,
    ].map((line) => profile.indexOf(line));
    assert.notInclude(order, -1);
    assert.deepEqual(
      order,
      order.toSorted((a, b) => a - b),
    );
    assert.include(profile, `(subpath "${project}/.git")`);
  });

  it("quotes paths so a folder name can't change the profile", () => {
    const rules = SkycotFamilySandbox.familyFilesystem(
      { home, cwd: '/Users/kid/a") (allow default) ("', platform: "darwin", uid: 501 },
      { realpath: (path) => path, exists: () => false },
    );
    const profile = SkycotFamilySandbox.familySeatbeltProfile(rules, "none");
    assert.include(profile, '(subpath "/Users/kid/a\\") (allow default) (\\"")');
    assert.notInclude(profile, '"/Users/kid/a") (allow default)');
  });
});
