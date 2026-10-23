import type { OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  latestRetryCheckpoint,
  latestReviewable,
  mayHaveChanges,
  reviewTargetFor,
} from "./turnReview";

const THREAD = "thread:card" as ThreadId;

function point(ordinal: number, runId: string | null, files: number) {
  return {
    id: `cp:${ordinal}`,
    scopeId: "scope:root",
    runId,
    ordinalWithinScope: ordinal,
    appRunOrdinal: runId === null ? null : ordinal,
    parentCheckpointId: ordinal === 0 ? null : `cp:${ordinal - 1}`,
    capturedAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 22, 9, ordinal)),
    files: Array.from({ length: files }, (_, i) => ({
      path: `page-${i}.html`,
      kind: "modified",
      additions: 1,
      deletions: 0,
    })),
  };
}

function projection(
  checkpoints: ReadonlyArray<ReturnType<typeof point>>,
  runs: ReadonlyArray<{ id: string; status: string }>,
): OrchestrationV2ThreadProjection {
  return {
    checkpointScopes: [{ id: "scope:root", kind: "root_run" }],
    checkpoints,
    runs,
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("a retry after a turn that failed part-way", () => {
  // The birthday card: the allowance ran out mid-way, "Please try again" finished it.
  const retried = projection(
    [point(0, null, 0), point(1, null, 0), point(2, "run:2", 0)],
    [
      { id: "run:1", status: "failed" },
      { id: "run:2", status: "completed" },
    ],
  );

  it("measures the retry from the conversation's start, so the page shows", () => {
    const target = reviewTargetFor(retried, THREAD, "cp:2");
    expect(target?.diffInput).toEqual({ threadId: THREAD, fromTurnCount: 0, toTurnCount: 2 });
    expect(target?.before?.id).toBe("cp:0");
  });

  it("is the newest card to look at even though its own list is empty", () => {
    expect(latestReviewable(retried)).toBeUndefined();
    expect(latestRetryCheckpoint(retried)?.id).toBe("cp:2");
    expect(mayHaveChanges(retried, retried.checkpoints[2]!)).toBe(true);
  });

  it("changes nothing for ordinary turns", () => {
    const ordinary = projection(
      [point(0, null, 0), point(1, "run:1", 1), point(2, "run:2", 0)],
      [
        { id: "run:1", status: "completed" },
        { id: "run:2", status: "completed" },
      ],
    );
    expect(reviewTargetFor(ordinary, THREAD, "cp:2")?.diffInput).toEqual({
      threadId: THREAD,
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    expect(reviewTargetFor(ordinary, THREAD, "cp:2")?.before?.id).toBe("cp:1");
    expect(mayHaveChanges(ordinary, ordinary.checkpoints[2]!)).toBe(false);
    expect(latestRetryCheckpoint(ordinary)).toBeUndefined();
  });
});
