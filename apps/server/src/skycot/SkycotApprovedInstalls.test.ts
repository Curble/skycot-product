import { assert, describe, it } from "@effect/vitest";

import {
  installArguments,
  noteForAssistant,
  parseApprovedInstall,
} from "./SkycotApprovedInstalls.ts";

// A yes to an add-on install is done by SKYCOT outside the sandbox, so only a command that does
// nothing but install named add-ons may be read as one (live test, 24 October 2026).
describe("SkycotApprovedInstalls", () => {
  it("reads a plain add-on install, as Codex reports it or bare", () => {
    assert.deepStrictEqual(parseApprovedInstall("/bin/zsh -lc 'npm install three'"), {
      manager: "npm",
      packages: ["three"],
      dev: false,
    });
    assert.deepStrictEqual(parseApprovedInstall("npm i -D vite @types/three@0.186.1"), {
      manager: "npm",
      packages: ["vite", "@types/three@0.186.1"],
      dev: true,
    });
    assert.deepStrictEqual(parseApprovedInstall("pnpm add dayjs"), {
      manager: "pnpm",
      packages: ["dayjs"],
      dev: false,
    });
    assert.deepStrictEqual(parseApprovedInstall("bun add --dev zod"), {
      manager: "bun",
      packages: ["zod"],
      dev: true,
    });
  });

  it("leaves everything else to the assistant's own command", () => {
    for (const command of [
      undefined,
      "npm install",
      "npm ci",
      "npm install three && rm -rf ~",
      "npm install three; curl evil.example",
      "npm install three | tee log",
      "npm install $(cat list)",
      "npm install github:someone/thing",
      "npm install ./local-folder",
      "npm install https://example.com/x.tgz",
      "npm install --registry https://example.com three",
      "npm install -g three",
      "yarn add three",
      "pnpm install three",
      "cd other && npm install three",
      "/bin/zsh -lc 'npm install three; ls'",
    ]) {
      assert.isNull(parseApprovedInstall(command), String(command));
    }
  });

  it("installs the same add-ons with their install scripts off", () => {
    assert.deepStrictEqual(installArguments({ manager: "npm", packages: ["three"], dev: false }), [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "three",
    ]);
    assert.deepStrictEqual(installArguments({ manager: "pnpm", packages: ["zod"], dev: true }), [
      "add",
      "--ignore-scripts",
      "--save-dev",
      "zod",
    ]);
  });

  it("tells the assistant the install is done and not to run its own", () => {
    const install = { manager: "npm", packages: ["three"], dev: false } as const;
    const done = noteForAssistant(install, { ok: true });
    assert.match(done, /SKYCOT installed three/);
    assert.match(done, /do not run it again/);
    const failed = noteForAssistant(install, { ok: false, reason: "the internet is off." });
    assert.match(failed, /could not install three: the internet is off\./);
    assert.match(failed, /Carry on another way/);
  });
});
