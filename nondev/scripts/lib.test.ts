import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  collectModuleExports,
  defaultMarker,
  diffExports,
  extractExports,
  extractImports,
  formatOutputs,
  globToRegExp,
  idFromPath,
  isOurPath,
  isSensitivePath,
  joinPkgPath,
  matchesGlob,
  parseConflictPaths,
  parseManifest,
  resolveExportSubpath,
  splitSpecifier,
  tail,
} from "./lib.ts";

NodeTest.describe("glob matching", () => {
  NodeTest.it("handles **, * and ? anchored to the whole path", () => {
    NodeAssert.ok(matchesGlob("apps/nondev/**", "apps/nondev/src/main.tsx"));
    NodeAssert.ok(matchesGlob("apps/nondev/**", "apps/nondev/package.json"));
    NodeAssert.ok(!matchesGlob("apps/nondev/**", "apps/nondevx/package.json"));
    NodeAssert.ok(
      matchesGlob(".github/workflows/nondev-*.yml", ".github/workflows/nondev-sync.yml"),
    );
    NodeAssert.ok(!matchesGlob(".github/workflows/nondev-*.yml", ".github/workflows/ci.yml"));
    NodeAssert.ok(
      !matchesGlob(".github/workflows/nondev-*.yml", ".github/workflows/nondev-a/b.yml"),
    );
    NodeAssert.ok(matchesGlob("assets/**/icon.png", "assets/icon.png"));
    NodeAssert.ok(matchesGlob("assets/**/icon.png", "assets/prod/mac/icon.png"));
    NodeAssert.ok(matchesGlob("src/?.ts", "src/a.ts"));
    NodeAssert.ok(!matchesGlob("src/?.ts", "src/ab.ts"));
    NodeAssert.ok(globToRegExp("a.b").test("a.b") && !globToRegExp("a.b").test("axb"));
  });

  NodeTest.it("knows which paths the fork owns", () => {
    NodeAssert.ok(isOurPath("nondev/scripts/lib.ts"));
    NodeAssert.ok(isOurPath("SEAM-MANIFEST.md"));
    NodeAssert.ok(isOurPath("docs/nondev/guide.md"));
    NodeAssert.ok(isOurPath("docs/legal/ATTRIBUTION.md"));
    NodeAssert.ok(isOurPath("docs/security/x.md"));
    NodeAssert.ok(isOurPath("docs/qa/plan.md"));
    NodeAssert.ok(isOurPath("docs/skycot-site/index.html"));
    NodeAssert.ok(isOurPath("NOTICE"));
    NodeAssert.ok(isOurPath("CONTRIBUTING-THEMES.md"));
    NodeAssert.ok(isOurPath("packages/skycot-rules/src/index.ts"));
    NodeAssert.ok(isOurPath("apps/server/src/skycot/providerPolicy.ts"));
    NodeAssert.ok(isOurPath("apps/nondev/themes-community/ocean.json"));
    NodeAssert.ok(!isOurPath("apps/server/scripts/cli.ts"));
    NodeAssert.ok(!isOurPath("apps/server/src/skycotx/other.ts"));
    NodeAssert.ok(!isOurPath("LICENSE"));
    NodeAssert.ok(!isOurPath("pnpm-lock.yaml"));
  });

  NodeTest.it("flags security-sensitive upstream paths", () => {
    NodeAssert.ok(isSensitivePath(".github/workflows/ci.yml"));
    NodeAssert.ok(isSensitivePath("apps/server/src/auth/EnvironmentAuth.ts"));
    NodeAssert.ok(isSensitivePath("apps/server/src/httpCors.ts"));
    NodeAssert.ok(isSensitivePath("apps/desktop/src/electron/ElectronProtocol.ts"));
    NodeAssert.ok(isSensitivePath("package.json"));
    NodeAssert.ok(isSensitivePath("apps/web/package.json"));
    NodeAssert.ok(isSensitivePath("patches/foo.patch"));
    NodeAssert.ok(isSensitivePath("scripts/build-desktop-artifact.ts"));
    NodeAssert.ok(!isSensitivePath("apps/web/src/App.tsx"));
    NodeAssert.ok(!isSensitivePath("apps/server/src/orchestration-v2/Orchestrator.ts"));
    NodeAssert.ok(!isSensitivePath("apps/server/scripts/cli.ts"));
  });
});

NodeTest.describe("parseManifest", () => {
  const manifest = `# Seam manifest

Some prose with a \`fake/path.ts\` that must be ignored because a table exists.

| id | file | lines | reason | marker | upstream churn |
|---|---|---|---|---|---|
| server-copy-dist | \`apps/server/scripts/cli.ts\` | 88-96 | copy our dist into dist/client/simple | \`// nondev-seam: server-copy-dist\` | 12/110d |
| server-devdep | apps/server/package.json | devDependencies | workspace dep | none (JSON) | 67 |
| knip | knip.jsonc | 40 | ignoreDependencies | | 31 |
| icons | assets/prod/** | — | brand icons | (binary) | 5 |
`;

  NodeTest.it("reads rows with flexible markers", () => {
    const { seams, warnings } = parseManifest(manifest);
    NodeAssert.equal(seams.length, 4);
    NodeAssert.deepEqual(warnings, []);
    const [a, b, c, d] = seams;
    NodeAssert.equal(a!.id, "server-copy-dist");
    NodeAssert.equal(a!.file, "apps/server/scripts/cli.ts");
    NodeAssert.equal(a!.lines, "88-96");
    NodeAssert.equal(a!.marker, "nondev-seam: server-copy-dist");
    NodeAssert.equal(a!.upstreamChurn, "12/110d");
    NodeAssert.equal(b!.marker, null, "JSON files cannot carry a marker");
    NodeAssert.equal(
      c!.marker,
      defaultMarker("knip"),
      "empty marker cell falls back to the convention",
    );
    NodeAssert.equal(d!.marker, null, "binary globs have no marker");
    NodeAssert.equal(d!.file, "assets/prod/**");
  });

  NodeTest.it(
    "accepts a different column order and derives ids when the id column is missing",
    () => {
      const { seams, warnings } = parseManifest(
        `| path | why | marker |\n|---|---|---|\n| scripts/dev-runner.ts | add our filter | # nondev-seam: dev-runner |\n`,
      );
      NodeAssert.equal(seams.length, 1);
      NodeAssert.equal(seams[0]!.id, idFromPath("scripts/dev-runner.ts"));
      NodeAssert.equal(
        seams[0]!.marker,
        "nondev-seam: dev-runner",
        "comment prefix is stripped so any language works",
      );
      NodeAssert.equal(seams[0]!.reason, "add our filter");
      NodeAssert.ok(warnings.some((w) => w.includes("`id` column")));
    },
  );

  NodeTest.it("falls back to back-ticked paths when there is no table", () => {
    const { seams, warnings } = parseManifest(
      "We edited `apps/server/vite.config.ts` and `knip.jsonc` and visited `https://example.com/x`.\n",
    );
    NodeAssert.deepEqual(
      seams.map((s) => s.file),
      ["apps/server/vite.config.ts"],
    );
    NodeAssert.ok(warnings[0]!.includes("no table"));
  });

  NodeTest.it("flags duplicate ids", () => {
    const { warnings } = parseManifest(`| id | file |\n|---|---|\n| x | a.ts |\n| x | b.ts |\n`);
    NodeAssert.ok(warnings.some((w) => w.includes("appears 2 times")));
  });
});

NodeTest.describe("extractExports", () => {
  NodeTest.it("finds declarations, lists, re-exports and default", () => {
    const src = `
// export const commentedOut = 1
/* export function alsoCommented() {} */
export const A = 1;
export let B = 2;
export async function fetchIt() {}
export function* gen() {}
export class K {}
export abstract class AK {}
export type T = string;
export interface I {}
export enum E { X }
export declare const D: number;
export default function main() {}
export { x, y as Y, type Z } from "./other";
export { local1, local2 as L2 };
export type { OnlyType } from "./t";
export * as ns from "./ns";
export * from "./star";
export const { d1, d2: D2 } = obj;
`;
    const scan = extractExports(src);
    NodeAssert.deepEqual(
      [...scan.names].sort(),
      [
        "A",
        "AK",
        "B",
        "D",
        "D2",
        "E",
        "I",
        "K",
        "L2",
        "OnlyType",
        "T",
        "Y",
        "Z",
        "d1",
        "default",
        "fetchIt",
        "gen",
        "local1",
        "ns",
        "x",
      ].sort(),
    );
    NodeAssert.deepEqual(scan.starFrom, ["./star"]);
    NodeAssert.ok(!scan.names.has("commentedOut"));
    NodeAssert.ok(!scan.names.has("alsoCommented"));
  });
});

NodeTest.describe("extractImports", () => {
  NodeTest.it("captures named, default, namespace, type-only and dynamic imports", () => {
    const src = `
import { Schema, type Thing as T2 } from "@t3tools/contracts";
import type { Only } from "@t3tools/contracts/settings";
import Def, { named } from "@t3tools/client-runtime/handoff";
import * as proxy from "@t3tools/shared/devProxy";
import "./side-effect.css";
import React from "react";
const lazy = await import("@t3tools/shared/model");
export { reexp } from "@t3tools/shared/git";
`;
    const uses = extractImports(src, (s) => s.startsWith("@t3tools/"));
    const by = Object.fromEntries(uses.map((u) => [u.specifier, u.names.sort()]));
    NodeAssert.deepEqual(by["@t3tools/contracts"], ["Schema", "Thing"]);
    NodeAssert.deepEqual(by["@t3tools/contracts/settings"], ["Only"]);
    NodeAssert.deepEqual(by["@t3tools/client-runtime/handoff"], ["default", "named"]);
    NodeAssert.deepEqual(by["@t3tools/shared/devProxy"], ["*"]);
    NodeAssert.deepEqual(by["@t3tools/shared/model"], ["*"]);
    NodeAssert.deepEqual(by["@t3tools/shared/git"], ["reexp"]);
    NodeAssert.ok(!("react" in by));
  });
});

NodeTest.describe("exports map resolution", () => {
  const exportsMap = {
    ".": { types: "./src/index.ts", import: "./src/index.ts" },
    "./settings": { types: "./src/settings.ts", import: "./src/settings.ts" },
    "./device/*": { default: "./src/device/*.ts" },
    "./plain": "./src/plain.ts",
  };
  NodeTest.it("resolves exact, pattern and string entries", () => {
    NodeAssert.equal(resolveExportSubpath(exportsMap, "."), "./src/index.ts");
    NodeAssert.equal(resolveExportSubpath(exportsMap, "./settings"), "./src/settings.ts");
    NodeAssert.equal(resolveExportSubpath(exportsMap, "./device/stream"), "./src/device/stream.ts");
    NodeAssert.equal(resolveExportSubpath(exportsMap, "./plain"), "./src/plain.ts");
    NodeAssert.equal(resolveExportSubpath(exportsMap, "./missing"), null);
    NodeAssert.equal(resolveExportSubpath("./index.ts", "."), "./index.ts");
  });
  NodeTest.it("splits specifiers and joins package paths", () => {
    NodeAssert.deepEqual(splitSpecifier("@t3tools/shared/devProxy"), {
      pkg: "@t3tools/shared",
      subpath: "./devProxy",
    });
    NodeAssert.deepEqual(splitSpecifier("@t3tools/contracts"), {
      pkg: "@t3tools/contracts",
      subpath: ".",
    });
    NodeAssert.deepEqual(splitSpecifier("@t3tools/client-runtime/device/stream"), {
      pkg: "@t3tools/client-runtime",
      subpath: "./device/stream",
    });
    NodeAssert.equal(
      joinPkgPath("packages/shared", "./src/devProxy.ts"),
      "packages/shared/src/devProxy.ts",
    );
    NodeAssert.equal(joinPkgPath("packages/shared/src", "../other.ts"), "packages/shared/other.ts");
  });
});

NodeTest.describe("diffExports", () => {
  const before = {
    files: new Map<string, string>([
      [
        "packages/contracts/package.json",
        JSON.stringify({ exports: { ".": "./src/index.ts", "./settings": "./src/settings.ts" } }),
      ],
      [
        "packages/contracts/src/index.ts",
        `export * from "./keybindings";\nexport const Root = 1;\n`,
      ],
      [
        "packages/contracts/src/keybindings.ts",
        `export const MAX_KEYBINDING_VALUE_LENGTH = 5;\nexport const KeybindingSchema = 1;\n`,
      ],
      ["packages/contracts/src/settings.ts", `export const SettingsSchema = 1;\n`],
      [
        "packages/shared/package.json",
        JSON.stringify({
          exports: { "./devProxy": "./src/devProxy.ts", "./gone": "./src/gone.ts" },
        }),
      ],
      [
        "packages/shared/src/devProxy.ts",
        `export const DEV_PROXIED_PATH_PREFIXES = [];\nexport const oldHelper = 1;\n`,
      ],
      ["packages/shared/src/gone.ts", `export const Gone = 1;\n`],
    ]),
  };
  const after = {
    files: new Map<string, string>([
      [
        "packages/contracts/package.json",
        JSON.stringify({ exports: { ".": "./src/index.ts", "./settings": "./src/settings.ts" } }),
      ],
      [
        "packages/contracts/src/index.ts",
        `export * from "./keybindings";\nexport const Root = 1;\n`,
      ],
      ["packages/contracts/src/keybindings.ts", `export const KeybindingSchema = 1;\n`],
      [
        "packages/contracts/src/settings.ts",
        `export const SettingsSchema = 1;\nexport const NewThing = 2;\n`,
      ],
      [
        "packages/shared/package.json",
        JSON.stringify({ exports: { "./devProxy": "./src/devProxy.ts" } }),
      ],
      ["packages/shared/src/devProxy.ts", `export const DEV_PROXIED_PATH_PREFIXES = [];\n`],
    ]),
  };

  NodeTest.it("follows export * and reports only removals we actually import", () => {
    NodeAssert.ok(
      collectModuleExports(before.files, "packages/contracts/src/index.ts").has(
        "MAX_KEYBINDING_VALUE_LENGTH",
      ),
    );
    const diff = diffExports(before, after, [
      { specifier: "@t3tools/contracts", names: ["MAX_KEYBINDING_VALUE_LENGTH", "Root"] },
      { specifier: "@t3tools/contracts/settings", names: ["SettingsSchema"] },
      { specifier: "@t3tools/shared/devProxy", names: ["*"] },
      { specifier: "@t3tools/shared/gone", names: ["Gone"] },
      { specifier: "react", names: ["default"] },
    ]);
    const by = Object.fromEntries(diff.entries.map((e) => [e.specifier, e]));
    NodeAssert.deepEqual(by["@t3tools/contracts"]!.removedAndUsed, ["MAX_KEYBINDING_VALUE_LENGTH"]);
    NodeAssert.deepEqual(by["@t3tools/contracts/settings"]!.removedAndUsed, []);
    NodeAssert.equal(by["@t3tools/shared/devProxy"]!.usedViaNamespace, true);
    NodeAssert.deepEqual(by["@t3tools/shared/devProxy"]!.removed, ["oldHelper"]);
    NodeAssert.equal(by["@t3tools/shared/gone"]!.moduleRemoved, true);
    NodeAssert.deepEqual(by["@t3tools/shared/gone"]!.removedAndUsed, ["Gone"]);
    NodeAssert.ok(!("react" in by), "non-engine packages are ignored");
    NodeAssert.equal(diff.summary.modulesChecked, 4);
    NodeAssert.equal(diff.summary.breaking, 2);
    NodeAssert.deepEqual(diff.allRemoved.get("packages/contracts/src/keybindings.ts"), [
      "MAX_KEYBINDING_VALUE_LENGTH",
    ]);
    NodeAssert.deepEqual(diff.allRemoved.get("packages/shared/src/gone.ts"), ["Gone"]);
  });
});

NodeTest.describe("formatting helpers", () => {
  NodeTest.it("tails logs and formats GITHUB_OUTPUT lines", () => {
    NodeAssert.equal(tail("a\nb\nc\n", 2), "b\nc");
    NodeAssert.equal(formatOutputs({ a: 1, b: "x\ny", c: true }), "a=1\nb=x y\nc=true\n");
  });
});

NodeTest.describe("parseConflictPaths", () => {
  NodeTest.it("reads every CONFLICT line shape git prints", () => {
    const out = [
      "Auto-merging apps/desktop/package.json",
      "CONFLICT (content): Merge conflict in apps/desktop/package.json",
      "CONFLICT (add/add): Merge conflict in docs/new file.md",
      "CONFLICT (modify/delete): scripts/old.ts deleted in 4f651cb10d and modified in HEAD.  Version HEAD of scripts/old.ts left in tree.",
      "CONFLICT (rename/delete): Rename a/b.ts->a/c.ts in HEAD. a/b.ts deleted in upstream.",
      "Automatic merge failed; fix conflicts and then commit the result.",
    ].join("\n");
    NodeAssert.deepEqual(parseConflictPaths(out), [
      "apps/desktop/package.json",
      "docs/new file.md",
      "scripts/old.ts",
      "a/b.ts",
    ]);
    NodeAssert.deepEqual(parseConflictPaths("Already up to date.\n"), []);
  });
});
