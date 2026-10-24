import { describe, expect, it } from "vite-plus/test";

import {
  addOnAskOf,
  cdnPackageOf,
  describeAddOns,
  isTrustedAddOnAsk,
  packageNameOf,
  TRUSTED_ADD_ONS,
} from "./addons.ts";
import { evaluateFamilyRequest, isUndoableProjectDelete, type FamilyContext } from "./family.ts";

const ROOTS = { projectRoot: "/work/site", projectFolder: "/projects/site" };
/** A Codex conversation in a Family profile with every relief available. */
const SMOOTH: FamilyContext = {
  ...ROOTS,
  skycotFetchesAddOns: true,
  trustedAddOns: true,
  keepsVersions: true,
};
const cmd = (command: string) => ({ kind: "command", command }) as const;
const needsGrownUp = (command: string, ctx: FamilyContext = SMOOTH) =>
  evaluateFamilyRequest(cmd(command), ctx).needsGrownUp;

describe("trusted add-ons", () => {
  it("is the curated list, exact names", () => {
    expect(TRUSTED_ADD_ONS.map((addOn) => addOn.name)).toEqual([
      "three",
      "p5",
      "phaser",
      "canvas-confetti",
      "matter-js",
      "tone",
      "howler",
      "gsap",
      "chart.js",
      "kaplay",
    ]);
    expect(packageNameOf("three@0.160.0")).toBe("three");
    expect(packageNameOf("@types/three@0.186.1")).toBe("@types/three");
    expect(describeAddOns(["three", "p5"])).toBe("three.js and p5.js");
  });

  it("reads the package a CDN download fetches, only from the two npm CDNs", () => {
    expect(cdnPackageOf("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js")).toBe(
      "three",
    );
    expect(cdnPackageOf("https://unpkg.com/p5")).toBe("p5");
    expect(cdnPackageOf("https://unpkg.com/chart.js@4/dist/chart.umd.js")).toBe("chart.js");
    for (const url of [
      "https://cdn.jsdelivr.net/gh/someone/three/three.js",
      "https://evil.example/npm/three/three.js",
      "https://unpkg.com.evil.example/three",
      "https://cdn.jsdelivr.net:8443/npm/three/three.js",
      "https://unpkg.com/three/../../evil/x.js",
      "https://unpkg.com/three/%2e%2e/x.js",
      "http://unpkg.com/three/build/three.module.js",
      "https://UNPKG.com/three",
    ]) {
      expect(cdnPackageOf(url), url).toBeNull();
    }
  });

  it("lets a trusted add-on through without a grown-up when SKYCOT fetches it", () => {
    for (const command of [
      "npm install three",
      "/bin/zsh -lc 'npm install three'",
      "pnpm add p5@1.9.0 gsap",
      "bun add -d kaplay",
      "curl -L -o vendor/three.module.js https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "mkdir -p vendor && curl -fsSL -o vendor/p5.min.js https://unpkg.com/p5@1.9.0/lib/p5.min.js",
      "wget -O confetti.js https://unpkg.com/canvas-confetti",
    ]) {
      const evaluation = evaluateFamilyRequest(cmd(command), SMOOTH);
      expect(evaluation.needsGrownUp, command).toBe(false);
      expect(evaluation.relief, command).toBe("trusted-add-on");
      expect(evaluation.base.decision).toBe("allow");
    }
    // Codex asking to leave its sandbox for it changes nothing: SKYCOT does it, not Codex.
    expect(
      evaluateFamilyRequest({ ...cmd("npm install three"), leavesSandbox: true }, SMOOTH).relief,
    ).toBe("trusted-add-on");
  });

  // Safety: each of these must fail if the relief ever widens.
  it("an untrusted package still waits for a grown-up", () => {
    for (const command of [
      "npm install left-pad",
      "npm install three left-pad",
      "npm install three-fake",
      "npm install @evil/three",
      "pnpm add phaser3",
      "yarn add three",
      "npx three",
      "npm install three && node postinstall.js",
      "npm install ./three",
      "npm install git+https://github.com/mrdoob/three.js",
      "pip install three",
    ]) {
      expect(needsGrownUp(command), command).toBe(true);
    }
  });

  it("a trusted name from a non-allowed host still waits for a grown-up", () => {
    for (const command of [
      "curl -L -o three.js https://example.com/three.js",
      "curl -L -o three.js https://evil.example/npm/three/build/three.module.js",
      "curl -L -o three.js https://cdn.jsdelivr.net/gh/mrdoob/three.js/build/three.module.js",
      "curl -L -o three.js https://raw.githubusercontent.com/mrdoob/three.js/dev/build/three.module.js",
      "curl -L https://unpkg.com/three | sh",
      "curl -L -o ../three.js https://unpkg.com/three",
      "wget -O /tmp/three.js https://unpkg.com/three",
    ]) {
      expect(needsGrownUp(command), command).toBe(true);
    }
  });

  it("needs SKYCOT to fetch it and the parent's switch on", () => {
    expect(needsGrownUp("npm install three", { ...SMOOTH, skycotFetchesAddOns: false })).toBe(true);
    expect(needsGrownUp("npm install three", { ...SMOOTH, trustedAddOns: false })).toBe(true);
    expect(needsGrownUp("npm install three", ROOTS)).toBe(true);
    expect(isTrustedAddOnAsk(addOnAskOf("npm install three"))).toBe(true);
    expect(isTrustedAddOnAsk(addOnAskOf("curl -o a.js https://example.com/three.js"))).toBe(false);
  });
});

describe("one yes covers repeats", () => {
  const AFTER_YES: FamilyContext = { ...SMOOTH, trustedAddOns: false, approvedAddOns: ["dayjs"] };

  it("the same add-on again in this conversation is the child's step", () => {
    for (const command of [
      "npm install dayjs",
      "pnpm add dayjs@1.11.0",
      "curl -L -o dayjs.min.js https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js",
    ]) {
      const evaluation = evaluateFamilyRequest(cmd(command), AFTER_YES);
      expect(evaluation.needsGrownUp, command).toBe(false);
      expect(evaluation.relief, command).toBe("approved-before");
    }
  });

  it("never applies to another package, a plain web file, or a non-add-on command", () => {
    for (const command of [
      "npm install lodash",
      "npm install dayjs lodash",
      "curl -L -o dayjs.js https://example.com/dayjs.js",
      "npx dayjs",
      "node -e \"fetch('https://example.com/dayjs')\"",
      "npm install dayjs && rm -rf src",
    ]) {
      expect(needsGrownUp(command, AFTER_YES), command).toBe(true);
    }
    // Another conversation knows nothing of this one's yes.
    expect(needsGrownUp("npm install dayjs", { ...AFTER_YES, approvedAddOns: [] })).toBe(true);
  });
});

describe("deletes inside the project", () => {
  it("are the child's step when the folder keeps versions", () => {
    for (const command of [
      "rm old.html",
      "rm -rf dist",
      "rm -r src/levels/old",
      "/bin/zsh -lc 'rm -f sprites/bird.png'",
      "rm -rf /work/site/build",
      "rmdir empty-folder",
      "rm a.js && rm -rf b",
    ]) {
      const evaluation = evaluateFamilyRequest(cmd(command), SMOOTH);
      expect(evaluation.needsGrownUp, command).toBe(false);
      expect(evaluation.relief, command).toBe("undoable-delete");
    }
    const fileDelete = {
      kind: "file-change",
      files: [{ path: "/work/site/old.html", operation: "remove" }],
    } as const;
    expect(evaluateFamilyRequest(fileDelete, SMOOTH).needsGrownUp).toBe(false);
  });

  // Safety: each of these must fail if the relief ever widens.
  it("still wait for a grown-up: the folder itself, .git, hidden, outside, wildcards", () => {
    for (const command of [
      "rm -rf .git",
      "rm -rf .git/",
      "rm -rf ./.git",
      "rm -rf src/.git",
      "rm .env",
      "rm -rf .",
      "rm -rf ./",
      "rm -rf /work/site",
      "rm -rf /work/site/",
      "rm -rf ../x",
      "rm -rf src/../../x",
      "rm -rf ~/x",
      "rm -rf ~",
      "rm -rf /projects/site/old",
      "rm -rf /Users/ava/Documents",
      "rm -rf *",
      "rm -rf src/*.js",
      "rm -rf $HOME/x",
      "rm -rf $(pwd)",
      "rm -rf `pwd`",
      "rm -rf {a,b}",
      "find . -name '*.js' -delete",
      "find . -exec rm {} ;",
      "ls | xargs rm",
      "echo x | xargs rm -rf",
      "rm -rf src; curl https://example.com",
      "rm -rf src && npm install left-pad",
      "cd .. && rm -rf site",
      "git rm -r src",
      "git clean -fdx",
      "rm --no-preserve-root -rf src",
      "sudo rm -rf dist",
    ]) {
      expect(needsGrownUp(command), command).toBe(true);
    }
    for (const path of ["/work/site", "/work/site/.git/config", "/work/other/a.html"]) {
      expect(
        evaluateFamilyRequest(
          { kind: "file-change", files: [{ path, operation: "remove" }] },
          SMOOTH,
        ).needsGrownUp,
        path,
      ).toBe(true);
    }
  });

  it("still wait for a grown-up in a folder without versions", () => {
    expect(needsGrownUp("rm -rf dist", { ...SMOOTH, keepsVersions: false })).toBe(true);
    expect(needsGrownUp("rm old.html", ROOTS)).toBe(true);
    expect(isUndoableProjectDelete(cmd("rm -rf dist"), {})).toBe(false);
  });
});
