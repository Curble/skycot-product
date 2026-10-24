import { describe, expect, it } from "vite-plus/test";
import { readBuildTimes, recordBuildTime } from "./buildTimes";

function memory() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("local build times", () => {
  it("keeps the last twenty samples per bucket and tolerates storage failures", () => {
    const storage = memory();
    for (let i = 1; i <= 22; i++)
      recordBuildTime({ kind: "game", model: "m", phase: "build", milliseconds: i }, storage);
    expect(readBuildTimes(storage)).toHaveLength(20);
    expect(readBuildTimes(storage)[0]?.milliseconds).toBe(3);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readBuildTimes(broken)).toEqual([]);
    expect(() =>
      recordBuildTime({ kind: "x", model: "m", phase: "plan", milliseconds: 2 }, broken),
    ).not.toThrow();
  });
});
