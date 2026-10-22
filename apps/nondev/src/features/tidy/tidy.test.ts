import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { cleanTitle, MAX_TITLE_LENGTH, putAwayBlocked } from "./tidy";

const withRuntime = (status: string | null, activeRunId: string | null = null) =>
  ({
    runtime: status === null ? null : { status, activeRunId },
  }) as unknown as Pick<EnvironmentThreadShell, "runtime">;

describe("cleanTitle", () => {
  it("keeps a name, tidying its spaces", () => {
    expect(cleanTitle("  Mia's   dinosaur\ngame ")).toEqual({
      ok: true,
      title: "Mia's dinosaur game",
    });
  });

  it("refuses an empty or blank name rather than saving it", () => {
    for (const blank of ["", "   ", "\n\t "]) {
      expect(cleanTitle(blank)).toEqual({ ok: false, reason: "Type a name first." });
    }
  });

  it("refuses a name longer than a magnet can hold", () => {
    expect(cleanTitle("a".repeat(MAX_TITLE_LENGTH)).ok).toBe(true);
    expect(cleanTitle("a".repeat(MAX_TITLE_LENGTH + 1)).ok).toBe(false);
  });
});

describe("putAwayBlocked", () => {
  it("lets a finished, stopped or never-run conversation be put away", () => {
    expect(putAwayBlocked(withRuntime(null), "Sam")).toBeNull();
    expect(putAwayBlocked(withRuntime("idle"), "Sam")).toBeNull();
    expect(putAwayBlocked(withRuntime("completed"), "Sam")).toBeNull();
    expect(putAwayBlocked(withRuntime("queued", null), "Sam")).toBeNull();
  });

  it("waits while the crew is working, and says how to stop", () => {
    for (const status of ["preparing", "starting", "running"]) {
      expect(putAwayBlocked(withRuntime(status, "run-1"), "Sam")).toBe(
        "Sam is still working. Wait until Sam finishes, or press Stop.",
      );
    }
    expect(putAwayBlocked(withRuntime("queued", "run-1"), "Sam")).not.toBeNull();
  });
});
