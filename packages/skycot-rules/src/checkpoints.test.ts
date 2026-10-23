import { describe, expect, it } from "vite-plus/test";

import { parseUnifiedDiff, retrySpan, type SpanCheckpoint } from "./checkpoints.ts";

const point = (
  ordinal: number,
  runId: string | null,
  appRunOrdinal: number | null = runId === null ? null : ordinal,
): SpanCheckpoint => ({
  id: `cp:${ordinal}`,
  scopeId: "scope:root",
  runId,
  ordinalWithinScope: ordinal,
  appRunOrdinal,
});

describe("retrySpan", () => {
  it("leaves an ordinary turn measured from its own before", () => {
    const checkpoints = [point(0, null), point(1, "run:1"), point(2, "run:2")];
    const runs = [
      { id: "run:1", status: "completed" },
      { id: "run:2", status: "completed" },
    ];
    expect(retrySpan(checkpoints, runs, checkpoints[1]!)).toBeNull();
    expect(retrySpan(checkpoints, runs, checkpoints[2]!)).toBeNull();
  });

  // The beta walkthrough: the allowance ran out while the birthday card was being written,
  // "Please try again" finished it. The engine saved a plain before at the retry's start
  // (ordinal 1, no run), so the retry's own change list was empty.
  it("spans a retry back to the conversation's start when the first turn failed", () => {
    const checkpoints = [point(0, null), point(1, null), point(2, "run:2")];
    const runs = [
      { id: "run:1", status: "failed" },
      { id: "run:2", status: "completed" },
    ];
    expect(retrySpan(checkpoints, runs, checkpoints[2]!)).toEqual({
      fromTurnCount: 0,
      before: checkpoints[0],
    });
  });

  it("spans back to the last turn that finished and saved", () => {
    const checkpoints = [point(0, null), point(1, "run:1"), point(2, null), point(3, "run:3")];
    const runs = [
      { id: "run:1", status: "completed" },
      { id: "run:2", status: "failed" },
      { id: "run:3", status: "completed" },
    ];
    expect(retrySpan(checkpoints, runs, checkpoints[3]!)).toEqual({
      fromTurnCount: 1,
      before: checkpoints[1],
    });
  });

  it("gives up when the last saved turn was stopped, which the turn diff cannot start from", () => {
    const checkpoints = [point(0, null), point(1, "run:1"), point(2, null), point(3, "run:3")];
    const runs = [
      { id: "run:1", status: "interrupted" },
      { id: "run:2", status: "failed" },
      { id: "run:3", status: "completed" },
    ];
    expect(retrySpan(checkpoints, runs, checkpoints[3]!)).toBeNull();
  });

  it("ignores saves that belong to no turn, and other scopes", () => {
    const checkpoints = [point(0, null), point(1, null), point(2, "run:2")];
    expect(retrySpan(checkpoints, [], checkpoints[0]!)).toBeNull();
    expect(retrySpan(checkpoints, [], checkpoints[1]!)).toBeNull();
    const elsewhere = { ...point(2, "run:2"), scopeId: "scope:other" };
    expect(retrySpan(checkpoints, [], elsewhere)).toBeNull();
  });
});

describe("parseUnifiedDiff", () => {
  it("reads new, edited, deleted, renamed and binary files", () => {
    const diff = [
      "diff --git a/birthday-card.html b/birthday-card.html",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/birthday-card.html",
      "@@ -0,0 +1,2 @@",
      "+<h1>Happy 80th, Nan!</h1>",
      "+<button>Confetti</button>",
      "diff --git a/style.css b/style.css",
      "--- a/style.css",
      "+++ b/style.css",
      "@@ -1 +1 @@",
      "-h1 { color: red; }",
      "+h1 { color: pink; }",
      "diff --git a/old.html b/old.html",
      "deleted file mode 100644",
      "diff --git a/a.png b/b.png",
      "rename from a.png",
      "rename to b.png",
      "Binary files a/a.png and b/b.png differ",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual([
      { path: "birthday-card.html", operation: "added", additions: 2, deletions: 0 },
      { path: "style.css", operation: "edited", additions: 1, deletions: 1 },
      { path: "old.html", operation: "deleted", additions: 0, deletions: 0 },
      {
        path: "b.png",
        oldPath: "a.png",
        operation: "renamed",
        additions: 0,
        deletions: 0,
        binary: true,
      },
    ]);
  });
});
