import { describe, expect, it } from "vite-plus/test";

import {
  normalizeForMatching,
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
