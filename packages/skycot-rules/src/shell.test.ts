import { describe, expect, it } from "vite-plus/test";

import {
  innerShellScript,
  normalizeForMatching,
  packageBinaryName,
  programTokens,
  splitShellSegments,
  unwrapShellWrapper,
} from "./shell.ts";

describe("splitShellSegments", () => {
  it("splits on &&, ||, ;, | and newlines but not inside quotes", () => {
    expect(splitShellSegments("a && b || c; d | e\nf")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(splitShellSegments("echo 'a && b' && c")).toEqual(["echo 'a && b'", "c"]);
  });
});

describe("programTokens", () => {
  it("drops env assignments, sudo and transparent wrappers", () => {
    expect(programTokens("FOO=1 sudo env time rm -rf x")).toEqual(["rm", "-rf", "x"]);
    expect(programTokens("bash -lc 'git status'")).toEqual(["git", "status"]);
    expect(programTokens("for f in *; do echo $f; done")).toEqual([]);
  });
});

describe("unwrapShellWrapper", () => {
  it("returns the script Codex wraps in /bin/zsh -lc", () => {
    expect(unwrapShellWrapper("/bin/zsh -lc 'cd /x && rm book.html'")).toBe(
      "cd /x && rm book.html",
    );
    expect(unwrapShellWrapper('bash -c "echo \\"hi\\""')).toBe('echo "hi"');
    expect(unwrapShellWrapper("pnpm test")).toBe("pnpm test");
  });
});

describe("normalizeForMatching", () => {
  it("undoes echo substitution and split quoting", () => {
    expect(normalizeForMatching("$(echo rm) -rf x")).toBe("rm -rf x");
    expect(normalizeForMatching("`echo rm` -rf x")).toBe("rm -rf x");
    expect(normalizeForMatching('r""m -rf x')).toBe("rm -rf x");
    expect(normalizeForMatching("r'm' -rf x")).toBe("rm -rf x");
    expect(normalizeForMatching('"r"m -rf x')).toBe("rm -rf x");
  });
});

describe("programTokens — wrappers and package runners", () => {
  it.each([
    ["npx vercel --prod", ["vercel", "--prod"]],
    ["npx -y vercel deploy --prod", ["vercel", "deploy", "--prod"]],
    ["npx --package=vercel -- vercel deploy", ["vercel", "deploy"]],
    ["npm exec -- vercel --prod", ["vercel", "--prod"]],
    ["pnpm dlx vercel --prod", ["vercel", "--prod"]],
    ["pnpm exec wrangler deploy", ["wrangler", "deploy"]],
    ["yarn dlx netlify deploy --prod", ["netlify", "deploy", "--prod"]],
    ["bunx vercel", ["vercel"]],
    ["bun x vercel", ["vercel"]],
    ["deno run -A npm:vercel --prod", ["vercel", "--prod"]],
    ["sudo -u root npx vercel", ["vercel"]],
    ["env FOO=1 npx vercel", ["vercel"]],
    ["nice -n 10 time npx vercel", ["vercel"]],
    ["timeout 30 npx vercel", ["vercel"]],
    ["xargs -n 1 npx vercel", ["vercel"]],
    ["command npx vercel", ["vercel"]],
    ["/opt/homebrew/bin/npx vercel", ["vercel"]],
    ["npx @netlify/cli deploy --prod", ["netlify", "deploy", "--prod"]],
    ["npx firebase-tools deploy", ["firebase", "deploy"]],
    ["npx -c 'vercel --prod'", ["vercel", "--prod"]],
    ["sh -c 'npx vercel --prod'", ["vercel", "--prod"]],
    ["node node_modules/vercel/dist/index.js --prod", ["vercel", "--prod"]],
    ["npx prettier --write .", ["prettier", "--write", "."]],
    ["command -v vercel", ["command", "-v", "vercel"]],
    ["yarn build", ["yarn", "build"]],
  ])("%s → %j", (command, expected) => {
    expect(programTokens(command)).toEqual(expected);
  });

  it("unwraps `yarn <bin>` and `pnpm <bin>` only for the bins it is told about", () => {
    const bins = new Set(["vercel"]);
    expect(programTokens("yarn vercel --prod", { bins })).toEqual(["vercel", "--prod"]);
    expect(programTokens("pnpm vercel --prod", { bins })).toEqual(["vercel", "--prod"]);
    expect(programTokens("npm run vercel", { bins })).toEqual(["vercel"]);
    expect(programTokens("yarn eslint .", { bins })).toEqual(["yarn", "eslint", "."]);
    expect(programTokens("yarn vercel --prod")).toEqual(["yarn", "vercel", "--prod"]);
  });
});

describe("innerShellScript", () => {
  it("returns the script a shell runs, through transparent wrappers", () => {
    expect(innerShellScript("sh -c 'a && b'")).toBe("a && b");
    expect(innerShellScript('sudo bash -lc "npx vercel && rm x"')).toBe("npx vercel && rm x");
    expect(innerShellScript("npx vercel")).toBeNull();
    expect(innerShellScript("bash script.sh")).toBeNull();
  });
});

describe("packageBinaryName", () => {
  it("maps package specs onto the binary they install", () => {
    expect(packageBinaryName("vercel@33.0.0")).toBe("vercel");
    expect(packageBinaryName("@netlify/cli")).toBe("netlify");
    expect(packageBinaryName("@expo/eas-cli@latest")).toBe("eas");
    expect(packageBinaryName("firebase-tools")).toBe("firebase");
    expect(packageBinaryName("npm:wrangler")).toBe("wrangler");
    expect(packageBinaryName("@scope/thing")).toBe("thing");
  });
});

describe("normalizeForMatching — command substitution wrappers", () => {
  it("replaces $(which x), `command -v x` and $(npm bin)/ with the program", () => {
    expect(normalizeForMatching("$(which vercel) --prod")).toBe("vercel --prod");
    expect(normalizeForMatching("`command -v rm` -rf x")).toBe("rm -rf x");
    expect(normalizeForMatching("$(npm bin)/vercel --prod")).toBe("vercel --prod");
    expect(normalizeForMatching("$(type -p git) push")).toBe("git push");
  });
});
