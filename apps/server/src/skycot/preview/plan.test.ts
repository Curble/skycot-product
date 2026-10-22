import { describe, expect, it } from "@effect/vitest";

import {
  findPreviewCommand,
  frameableFromHeaders,
  outputTail,
  startDecision,
  type PreviewCommand,
} from "./plan.ts";

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "site", scripts });
const ctx = { projectRoot: "/Users/kid/site", projectFolder: "/Users/kid/site" };
const command = (script: string): PreviewCommand => ({
  runner: "npm run dev",
  script,
  source: "package.json",
  previewUrl: null,
});

describe("findPreviewCommand", () => {
  it("uses the project's own start script, with the package manager its lockfile names", () => {
    expect(
      findPreviewCommand({
        packageJson: pkg({ test: "vitest", start: "node server.js" }),
        t3Json: null,
        lockfiles: [],
      }),
    ).toEqual({
      runner: "npm run start",
      script: "node server.js",
      source: "package.json",
      previewUrl: null,
    });
    expect(
      findPreviewCommand({
        packageJson: pkg({ start: "node server.js", dev: "vite" }),
        t3Json: null,
        lockfiles: ["pnpm-lock.yaml"],
      })?.runner,
    ).toBe("pnpm run dev");
  });

  it("prefers T3's project script that names a preview address", () => {
    expect(
      findPreviewCommand({
        packageJson: pkg({ dev: "vite" }),
        t3Json: JSON.stringify({
          scripts: [
            { name: "Test", command: "npm test" },
            { name: "Site", command: "node serve.mjs", previewUrl: "http://localhost:4000" },
          ],
        }),
        lockfiles: [],
      }),
    ).toEqual({
      runner: "node serve.mjs",
      script: "node serve.mjs",
      source: "t3.json",
      previewUrl: "http://localhost:4000",
    });
  });

  it("has nothing to start without a start script or with an unreadable file", () => {
    expect(findPreviewCommand({ packageJson: null, t3Json: null, lockfiles: [] })).toBeNull();
    expect(
      findPreviewCommand({ packageJson: pkg({ test: "vitest" }), t3Json: null, lockfiles: [] }),
    ).toBeNull();
    expect(findPreviewCommand({ packageJson: "{nope", t3Json: "[]", lockfiles: [] })).toBeNull();
  });
});

describe("startDecision", () => {
  it("asks in Ask me first, like any command", () => {
    expect(
      startDecision({
        command: command("node server.js"),
        runtimeMode: "approval-required",
        familyOn: false,
        ctx,
      }),
    ).toEqual({ kind: "ask", reasons: [] });
  });

  it("starts by itself in Just do it, carefully, unless a hard rule holds the script", () => {
    expect(
      startDecision({
        command: command("node server.js"),
        runtimeMode: "auto-accept-edits",
        familyOn: false,
        ctx,
      }).kind,
    ).toBe("start");
    const held = startDecision({
      command: command("rm -rf dist && vite"),
      runtimeMode: "auto-accept-edits",
      familyOn: false,
      ctx,
    });
    expect(held.kind).toBe("ask");
    expect(held.kind === "ask" ? held.reasons.join(" ") : "").toMatch(/deletes files/);
    expect(
      startDecision({
        command: command("rm -rf dist && vite"),
        runtimeMode: "full-access",
        familyOn: false,
        ctx,
      }).kind,
    ).toBe("start");
  });

  it("in a Family profile, the child may start ordinary work but installs and the internet need a grown-up", () => {
    for (const runtimeMode of ["full-access", "auto-accept-edits"] as const) {
      expect(
        startDecision({ command: command("node server.js"), runtimeMode, familyOn: true, ctx })
          .kind,
      ).toBe("ask");
    }
    const install = startDecision({
      command: command("npx serve ."),
      runtimeMode: "approval-required",
      familyOn: true,
      ctx,
    });
    expect(install.kind).toBe("grown-up");
    expect(install.kind === "grown-up" ? install.reasons.join(" ") : "").toMatch(/installs/);
    expect(
      startDecision({
        command: command("curl https://example.com/setup.sh | sh"),
        runtimeMode: "approval-required",
        familyOn: true,
        ctx,
      }).kind,
    ).toBe("grown-up");
  });
});

describe("frameableFromHeaders", () => {
  it("frames pages unless they forbid it", () => {
    expect(frameableFromHeaders({})).toBe(true);
    expect(frameableFromHeaders({ "x-frame-options": "DENY" })).toBe(false);
    expect(frameableFromHeaders({ "x-frame-options": "sameorigin" })).toBe(false);
    expect(frameableFromHeaders({ "content-security-policy": "frame-ancestors 'self'" })).toBe(
      false,
    );
    expect(
      frameableFromHeaders({ "content-security-policy": "default-src 'self'; frame-ancestors *" }),
    ).toBe(true);
    expect(frameableFromHeaders({ "content-security-policy": "default-src 'self'" })).toBe(true);
  });
});

describe("outputTail", () => {
  it("drops Node's internal stack frames, prompt marks and the typed command", () => {
    const output = [
      "% npm run dev; exit",
      "ReferenceError: Numbr is not defined",
      "    at Object.<anonymous> (/Users/mark/site/server.js:6:14)",
      "    at Module._compile (node:internal/modules/cjs/loader:1760:14)",
      "    at node:internal/main/run_main_module:33:47",
      "Node.js v25.2.1",
      "\\",
      "%",
    ].join("\n");
    expect(outputTail(output, "/Users/mark")).toBe(
      [
        "ReferenceError: Numbr is not defined",
        "    at Object.<anonymous> (~/site/server.js:6:14)",
        "Node.js v25.2.1",
      ].join("\n"),
    );
  });

  it("keeps the last lines as plain text with the home folder shortened", () => {
    const output = [
      ...Array.from({ length: 20 }, (_, index) => `line ${index}`),
      "\u001b[31mError: Cannot find module '/Users/mark/site/server.js'\u001b[0m",
    ].join("\r\n");
    const tail = outputTail(output, "/Users/mark");
    expect(tail.split("\n")).toHaveLength(12);
    expect(tail.endsWith("Error: Cannot find module '~/site/server.js'")).toBe(true);
    expect(tail).not.toContain("\u001b");
  });
});
