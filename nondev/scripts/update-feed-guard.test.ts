import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import { REQUIRED_WIRING, ROOT, updateFeedProblems } from "./update-feed-guard.ts";

/** A throwaway copy of the files the guard reads, so a test can break one. */
function copyOfRepo(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-feed-guard-"));
  for (const file of [
    "nondev/brand.json",
    "nondev/brand/env.cjs",
    ...REQUIRED_WIRING.map((wiring) => wiring.file),
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

NodeTest.describe("SKYCOT never updates from T3 Code's releases", () => {
  NodeTest.it("passes on this checkout", () => {
    NodeAssert.deepEqual(updateFeedProblems(), []);
  });

  NodeTest.it("fails when brand.json names T3 Code's feed", () => {
    const dir = copyOfRepo();
    try {
      for (const feed of [
        "github:pingdotgg/t3code",
        "https://github.com/pingdotgg/t3code/releases/latest/download/",
      ]) {
        edit(dir, "nondev/brand.json", (text) =>
          text.replace(/"feed": (null|"[^"]*")/u, `"feed": ${JSON.stringify(feed)}`),
        );
        const problems = updateFeedProblems(dir);
        NodeAssert.ok(
          problems.some((problem) => problem.includes("T3 Code")),
          feed,
        );
      }
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  NodeTest.it("fails when an upstream merge drops a seam", () => {
    const dir = copyOfRepo();
    try {
      edit(dir, "scripts/build-desktop-artifact.ts", (text) =>
        text.replace("skycotPublishConfig(skycotFeed, updateChannel)", "null"),
      );
      edit(dir, "apps/desktop/src/updates/DesktopUpdates.ts", (text) =>
        text.replace(
          "SkycotUpdates.vetBakedFeed(yield* readAppUpdateYml)",
          "yield* readAppUpdateYml",
        ),
      );
      const problems = updateFeedProblems(dir);
      NodeAssert.ok(
        problems.some((problem) => problem.startsWith("scripts/build-desktop-artifact.ts")),
      );
      NodeAssert.ok(
        problems.some((problem) =>
          problem.startsWith("apps/desktop/src/updates/DesktopUpdates.ts"),
        ),
      );
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  NodeTest.it("fails when a committed updater config names T3 Code", () => {
    const dir = copyOfRepo();
    try {
      NodeFS.writeFileSync(
        NodePath.join(dir, "apps/desktop/dev-app-update.yml"),
        "provider: github\nowner: pingdotgg\nrepo: t3code\n",
      );
      NodeAssert.ok(
        updateFeedProblems(dir).some((problem) => problem.includes("dev-app-update.yml")),
      );
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
