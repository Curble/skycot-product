import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import {
  MODEL_MANIFEST_WIRING,
  REVIEWED_MENTIONS,
  ROOT,
  runtimeSourceFiles,
  t3AddressProblems,
} from "./t3-address-guard.ts";

/** A throwaway copy of the files the guard reads, so a test can break one. */
function copyOfRepo(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-t3-guard-"));
  for (const file of [
    "nondev/brand.json",
    "nondev/brand/env.cjs",
    MODEL_MANIFEST_WIRING.file,
    ...Object.keys(REVIEWED_MENTIONS),
  ]) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
    NodeFS.copyFileSync(NodePath.join(ROOT, file), NodePath.join(dir, file));
  }
  return dir;
}

function edit(dir: string, file: string, change: (text: string) => string) {
  const path = NodePath.join(dir, file);
  NodeFS.writeFileSync(path, change(NodeFS.readFileSync(path, "utf8")));
}

const UPSTREAM_MANIFEST_URL =
  "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";

NodeTest.describe("no T3 Code address is reachable from SKYCOT's engine", () => {
  NodeTest.it("passes on this checkout", () => {
    NodeAssert.deepEqual(t3AddressProblems(), []);
  });

  NodeTest.it("scans the server, the desktop shell and the shared packages", () => {
    const files = runtimeSourceFiles();
    NodeAssert.ok(files.includes(MODEL_MANIFEST_WIRING.file));
    NodeAssert.ok(files.some((file) => file.startsWith("apps/desktop/src/")));
    NodeAssert.ok(files.some((file) => file.startsWith("packages/shared/src/")));
    NodeAssert.ok(!files.some((file) => file.includes(".test.")));
  });

  NodeTest.it("fails when an upstream merge brings back T3's model-list address", () => {
    const dir = copyOfRepo();
    try {
      edit(dir, MODEL_MANIFEST_WIRING.file, (text) =>
        text.replace(
          "httpClient.get(remoteManifestUrl)",
          `httpClient.get(${JSON.stringify(UPSTREAM_MANIFEST_URL)})`,
        ),
      );
      const problems = t3AddressProblems(dir);
      NodeAssert.ok(problems.some((problem) => problem.includes("lost")));
      NodeAssert.ok(problems.some((problem) => problem.includes("names a T3 Code address")));
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  NodeTest.it("fails when brand.json names T3 Code's model list", () => {
    const dir = copyOfRepo();
    try {
      edit(dir, "nondev/brand.json", (text) =>
        text.replace(/"url": null/u, `"url": ${JSON.stringify(UPSTREAM_MANIFEST_URL)}`),
      );
      NodeAssert.ok(t3AddressProblems(dir).some((problem) => problem.includes("T3 Code's")));
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  NodeTest.it("fails on a new T3 address in runtime code, and when a .env turns Connect on", () => {
    const dir = copyOfRepo();
    try {
      const file = "apps/desktop/src/somewhere/new.ts";
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(dir, file),
        'export const NEWS = "https://t3.codes/news.json";\n',
      );
      NodeFS.writeFileSync(NodePath.join(dir, ".env"), "T3CODE_RELAY_URL=https://relay.t3.codes\n");
      const problems = t3AddressProblems(dir);
      NodeAssert.ok(problems.some((problem) => problem.startsWith(`${file}:1:`)));
      NodeAssert.ok(problems.some((problem) => problem.startsWith(".env: T3CODE_RELAY_URL")));
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
