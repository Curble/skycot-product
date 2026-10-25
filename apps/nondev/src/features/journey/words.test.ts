import { describe, expect, it, vi } from "vite-plus/test";
import { readBuildWord, readKnownWords, rememberBuildWord, rememberWord } from "./words";

describe("Words I know", () => {
  it("collects unique words separately for each child and tolerates blocked storage", () => {
    let data: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
    expect(rememberWord("ava", "test", storage)).toEqual(["test"]);
    expect(rememberWord("ava", "test", storage)).toEqual(["test"]);
    expect(readKnownWords("leo", storage)).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readKnownWords("ava", broken)).toEqual([]);
  });
});

describe("word chosen for a run", () => {
  it("survives a notebook remount, keeps the first choice and separates runs", () => {
    const data: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    });
    try {
      expect(readBuildWord("build")).toBeNull();
      rememberBuildWord("build", "page");
      rememberBuildWord("build", "test");
      expect(readBuildWord("build")).toBe("page");
      expect(readBuildWord("another-build")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
