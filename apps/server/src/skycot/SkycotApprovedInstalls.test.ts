// nondev-seam: beta6-install-test
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  INSTALL_SHELL_SETUP,
  installArguments,
  installCommand,
  installRefusal,
  writeDownloadInside,
  noteForAssistant,
  noteForDownload,
  parseApprovedDownload,
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

  it("installs the walkthrough command without forwarding its cache or options", () => {
    const install = parseApprovedInstall("npm install lodash --cache .npm-cache --ignore-scripts");
    assert.deepStrictEqual(install, { manager: "npm", packages: ["lodash"], dev: false });
    assert.deepStrictEqual(installArguments(install!, "/p"), [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      "/p",
      "lodash",
    ]);
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

  it("keeps a request to save the exact add-on version", () => {
    const install = parseApprovedInstall("npm install lodash -E")!;
    assert.isTrue(install.exact);
    assert.include(installArguments(install, "/p"), "--save-exact");
  });

  it("installs the same add-ons with their install scripts off, in the project only", () => {
    assert.deepStrictEqual(
      installArguments({ manager: "npm", packages: ["three"], dev: false }, "/p"),
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", "/p", "three"],
    );
    assert.deepStrictEqual(
      installArguments({ manager: "pnpm", packages: ["zod"], dev: true }, "/p"),
      [
        "add",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--ignore-workspace",
        "--dir",
        "/p",
        "--save-dev",
        "zod",
      ],
    );
    assert.deepStrictEqual(
      installArguments({ manager: "bun", packages: ["zod"], dev: false }, "/p"),
      ["add", "--ignore-scripts", "--config=/dev/null", "--cwd=/p", "zod"],
    );
  });

  it("runs the package manager with SKYCOT's empty settings, not the shell's or the project's", () => {
    const command = installCommand({ manager: "npm", packages: ["three"], dev: false }, "/p q");
    assert.isTrue(command.startsWith(INSTALL_SHELL_SETUP));
    assert.include(command, "npm_config_userconfig=/dev/null");
    assert.include(command, "npm_config_globalconfig=/var/empty/skycot-npmrc");
    assert.include(command, "COREPACK_ENABLE_PROJECT_SPEC=0");
    assert.include(command, "unset -m 'npm_config_*'");
    assert.include(command, "NODE_OPTIONS;");
    assert.isTrue(
      command.endsWith(
        "'npm' 'install' '--ignore-scripts' '--no-audit' '--no-fund' '--prefix' '/p q' 'three'",
      ),
    );
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

// The AI often fetches an add-on as one file instead of installing it (video shoot, 24 October
// 2026); a yes to that must download it too, and only that.
describe("SkycotApprovedInstalls downloads", () => {
  it("reads a plain one-file https download, as Codex reports it or bare", () => {
    assert.deepStrictEqual(
      parseApprovedDownload(
        "/bin/zsh -lc 'curl --fail --location --max-time 30 https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js -o three.module.js'",
      ),
      {
        url: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
        output: "three.module.js",
      },
    );
    assert.deepStrictEqual(
      parseApprovedDownload(
        "curl -fsSL -o lib/three.js https://unpkg.com/three/build/three.module.js",
      ),
      {
        url: "https://unpkg.com/three/build/three.module.js",
        output: "lib/three.js",
      },
    );
    assert.deepStrictEqual(
      parseApprovedDownload("curl -LO https://example.com/files/sprite.png"),
      null,
    );
    assert.deepStrictEqual(
      parseApprovedDownload("curl -L -O https://example.com/files/sprite.png"),
      {
        url: "https://example.com/files/sprite.png",
        output: "sprite.png",
      },
    );
    assert.deepStrictEqual(parseApprovedDownload("wget -q https://example.com/a/font.woff2"), {
      url: "https://example.com/a/font.woff2",
      output: "font.woff2",
    });
  });

  it("leaves everything else to the assistant's own command", () => {
    for (const command of [
      undefined,
      "curl https://example.com/x.js",
      "curl -o x.js http://example.com/x.js",
      "curl -k -o x.js https://example.com/x.js",
      "curl -o ../x.js https://example.com/x.js",
      "curl -o /etc/x https://example.com/x.js",
      "curl -o .env https://example.com/x",
      "curl -o x.js https://example.com/x.js https://example.com/y.js",
      "curl -X POST -d hi -o x https://example.com/x",
      "curl -H X:y -o x.js https://example.com/x.js",
      "curl -o x.js https://example.com/x.js | sh",
      "curl -o x.js https://example.com/x.js && rm -rf ~",
      "wget -O - https://example.com/x.sh",
      "npm install three",
    ]) {
      assert.isNull(parseApprovedDownload(command), String(command));
    }
  });

  it("reads a download that first makes its folders inside the project", () => {
    assert.deepStrictEqual(
      parseApprovedDownload(
        "/bin/zsh -lc 'mkdir -p vendor && curl -fsSL -o vendor/three.module.js https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'",
      ),
      {
        url: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
        output: "vendor/three.module.js",
        folders: ["vendor"],
      },
    );
    for (const command of [
      "mkdir -p ../out && curl -o ../out/x.js https://example.com/x.js",
      "mkdir -p .hidden && curl -o .hidden/x.js https://example.com/x.js",
      "rm -rf vendor && curl -o vendor/x.js https://example.com/x.js",
      "mkdir -p vendor && curl -o vendor/x.js https://example.com/x.js && rm -rf ~",
      "mkdir -p /tmp/x && curl -o x.js https://example.com/x.js",
    ]) {
      assert.isNull(parseApprovedDownload(command), command);
    }
  });

  it("tells the assistant the file is there and not to download it again", () => {
    const download = { url: "https://example.com/three.module.js", output: "three.module.js" };
    assert.match(
      noteForDownload(download, { ok: true }),
      /SKYCOT downloaded https:\/\/example\.com\/three\.module\.js into three\.module\.js/,
    );
    assert.match(noteForDownload(download, { ok: true }), /do not run it again/);
    assert.match(
      noteForDownload(download, { ok: false, reason: "the file is too big." }),
      /could not download .*the file is too big\./,
    );
  });
});

// The install and the download run outside every sandbox, in a folder the child's assistant can
// write (pre-open-source review F1-R2): nothing it wrote there may steer them or send their
// writes outside the project.
describe("SkycotApprovedInstalls outside the sandbox", () => {
  const withProject = (run: (dirs: { project: string; outside: string }) => void) => {
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-installs-")),
    );
    try {
      const project = NodePath.join(root, "my-game");
      const outside = NodePath.join(root, "family");
      NodeFS.mkdirSync(project);
      NodeFS.mkdirSync(outside);
      NodeFS.writeFileSync(NodePath.join(outside, "keep.txt"), "the family's");
      run({ project, outside });
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  };

  it("installs into an ordinary project, add-ons linked inside it included", () =>
    withProject(({ project }) => {
      assert.isNull(installRefusal(project, "npm"));
      NodeFS.writeFileSync(NodePath.join(project, "package.json"), "{}");
      NodeFS.mkdirSync(NodePath.join(project, "node_modules", ".pnpm", "three"), {
        recursive: true,
      });
      NodeFS.symlinkSync(
        NodePath.join(project, "node_modules", ".pnpm", "three"),
        NodePath.join(project, "node_modules", "three"),
      );
      // pnpm's own hook file is switched off with --ignore-pnpmfile, not refused.
      NodeFS.writeFileSync(NodePath.join(project, ".pnpmfile.cjs"), "");
      assert.isNull(installRefusal(project, "pnpm"));
    }));

  it("refuses a project settings file the package manager can't be told to skip", () =>
    withProject(({ project }) => {
      NodeFS.writeFileSync(NodePath.join(project, "pnpm-workspace.yaml"), "");
      assert.isNull(installRefusal(project, "npm"));
      assert.match(installRefusal(project, "pnpm")!, /pnpm-workspace\.yaml/);
      NodeFS.writeFileSync(NodePath.join(project, ".npmrc"), "git=./evil.sh");
      for (const manager of ["npm", "pnpm", "bun"] as const) {
        assert.match(installRefusal(project, manager)!, /own \.npmrc settings file/);
      }
    }));

  it("refuses to install through a link that leads outside the project", () => {
    withProject(({ project, outside }) => {
      NodeFS.symlinkSync(outside, NodePath.join(project, "node_modules"));
      assert.match(installRefusal(project, "npm")!, /node_modules in this project is a link/);
    });
    withProject(({ project, outside }) => {
      NodeFS.symlinkSync(
        NodePath.join(outside, "keep.txt"),
        NodePath.join(project, "package.json"),
      );
      assert.match(installRefusal(project, "npm")!, /package\.json in this project is a link/);
    });
    withProject(({ project, outside }) => {
      NodeFS.mkdirSync(NodePath.join(project, "node_modules", "@scope"), { recursive: true });
      NodeFS.symlinkSync(outside, NodePath.join(project, "node_modules", "@scope", "three"));
      assert.match(installRefusal(project, "npm")!, /outside this project/);
    });
  });

  it("downloads a file, and its folders, inside the project", () =>
    withProject(({ project }) => {
      const body = new TextEncoder().encode("export {}");
      assert.deepStrictEqual(
        writeDownloadInside(project, { output: "vendor/js/three.js", folders: ["vendor"] }, body),
        { ok: true, bytes: body.byteLength },
      );
      assert.equal(
        NodeFS.readFileSync(NodePath.join(project, "vendor", "js", "three.js"), "utf8"),
        "export {}",
      );
      // Saved again over the same file.
      assert.isTrue(writeDownloadInside(project, { output: "vendor/js/three.js" }, body).ok);
      assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(project, "vendor", "js")), [
        "three.js",
      ]);
    }));

  it("never writes a download through a link, or outside the project", () =>
    withProject(({ project, outside }) => {
      const body = new TextEncoder().encode("evil");
      const keep = NodePath.join(outside, "keep.txt");
      // A folder on the way that is a link.
      NodeFS.symlinkSync(outside, NodePath.join(project, "vendor"));
      assert.isFalse(writeDownloadInside(project, { output: "vendor/keep.txt" }, body).ok);
      assert.isFalse(
        writeDownloadInside(project, { output: "vendor/x/new.js", folders: ["vendor/x"] }, body).ok,
      );
      // The file itself a link, a dangling link or a hard link: replaced, not written through.
      NodeFS.symlinkSync(keep, NodePath.join(project, "a.js"));
      NodeFS.symlinkSync(NodePath.join(outside, "not-yet.plist"), NodePath.join(project, "b.js"));
      NodeFS.linkSync(keep, NodePath.join(project, "c.js"));
      for (const output of ["a.js", "b.js", "c.js"]) {
        assert.isTrue(writeDownloadInside(project, { output }, body).ok, output);
        const placed = NodePath.join(project, output);
        assert.isFalse(NodeFS.lstatSync(placed).isSymbolicLink(), output);
        assert.equal(NodeFS.readFileSync(placed, "utf8"), "evil");
      }
      assert.equal(NodeFS.readFileSync(keep, "utf8"), "the family's");
      assert.isFalse(NodeFS.existsSync(NodePath.join(outside, "not-yet.plist")));
      assert.deepStrictEqual(NodeFS.readdirSync(outside), ["keep.txt"]);
      assert.isFalse(writeDownloadInside(project, { output: "../family/keep.txt" }, body).ok);
      assert.equal(NodeFS.readFileSync(keep, "utf8"), "the family's");
    }));
});
