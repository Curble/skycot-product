import { describe, expect, it } from "vite-plus/test";
import { readKnownWords, rememberWord } from "./words";

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
