import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import {
  cleanTitle,
  deleteBlocked,
  deleteSheetCopy,
  MAX_TITLE_LENGTH,
  putAwayBlocked,
  quotedName,
} from "./tidy";

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

describe("deleteSheetCopy", () => {
  it("says what goes, what stays and that it can't be undone", () => {
    const copy = deleteSheetCopy({ title: "Dino game", archived: false, family: false });
    expect(copy.title).toBe("Delete “Dino game”?");
    expect(copy.goes).toContain("every message");
    expect(copy.goes).toContain("restore points");
    expect(copy.stays.join(" ")).toContain("files stay on this Mac");
    expect(copy.stays.join(" ")).toContain("Stickers stay");
    expect(copy.final).toBe("This can't be undone.");
    expect(copy.button).toBe("Delete");
    expect(copy.alternative).toContain("put it away instead");
  });

  it("asks for the parent code in a Family profile", () => {
    const copy = deleteSheetCopy({ title: "Dino game", archived: true, family: true });
    expect(copy.button).toBe("Enter parent code…");
    expect(copy.final).toContain("parent code");
    // Already put away: no point suggesting it.
    expect(copy.alternative).toBeNull();
  });

  it("keeps a long or empty name short", () => {
    expect(quotedName("")).toBe("this conversation");
    const long = quotedName("a very long conversation name that keeps on going and going");
    expect(long.length).toBeLessThanOrEqual(42);
    expect(long.endsWith("…”")).toBe(true);
  });

  it("waits while the crew is working, like putting away", () => {
    expect(deleteBlocked(withRuntime("running", "run-1"), "Sam")).not.toBeNull();
    expect(deleteBlocked(withRuntime("idle"), "Sam")).toBeNull();
  });
});
