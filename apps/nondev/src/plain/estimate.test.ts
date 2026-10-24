import { describe, expect, it } from "vite-plus/test";
import { elapsedCopy, estimateBuildTime, estimateCopy, type BuildSample } from "./estimate";

describe("build time estimates", () => {
  it("uses the narrowest bucket with at least three samples", () => {
    const samples: BuildSample[] = [20, 30, 40].map((seconds) => ({
      kind: "game",
      model: "m",
      phase: "build",
      milliseconds: seconds * 1000,
    }));
    expect(estimateBuildTime(samples, { kind: "game", model: "m", phase: "build" })).toEqual({
      low: 20000,
      high: 30000,
    });
    expect(
      estimateBuildTime(samples.slice(0, 2), { kind: "game", model: "m", phase: "build" }),
    ).toBeNull();
  });
  it("falls back from kind and model to model, then phase", () => {
    const samples: BuildSample[] = [
      ...[10, 20].map((seconds) => ({
        kind: "other",
        model: "m",
        phase: "build" as const,
        milliseconds: seconds * 1000,
      })),
      ...[40, 50, 60].map((seconds) => ({
        kind: "game",
        model: "n",
        phase: "build" as const,
        milliseconds: seconds * 1000,
      })),
    ];
    expect(estimateBuildTime(samples, { kind: "game", model: "m", phase: "build" })).toEqual({
      low: 20000,
      high: 50000,
    });
    expect(
      estimateBuildTime(samples.slice(0, 2), { kind: "game", model: "missing", phase: "build" }),
    ).toBeNull();
  });
  it("has day-one copy and a gentle long-run message", () => {
    expect(estimateCopy("plan", null)).toBe("A few seconds…");
    expect(estimateCopy("build", null)).toBe("Most builds take 1 to 3 minutes.");
    expect(
      elapsedCopy(240000, "build", { low: 60000, high: 180000 }, "Testing your game"),
    ).toContain("now: Testing your game");
  });
});
