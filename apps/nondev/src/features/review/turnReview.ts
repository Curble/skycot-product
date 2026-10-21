// Pure lookups over a thread projection for the What-changed card: which
// checkpoint closed a turn, which run it belongs to, where "before" is, and how
// to ask the engine for the turn's diff.
import type {
  OrchestrationGetTurnDiffInput,
  OrchestrationV2Checkpoint,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { VersionEntry } from "../../plain/versions";

export interface ReviewTarget {
  readonly checkpoint: OrchestrationV2Checkpoint;
  readonly run: OrchestrationV2Run | null;
  /** The checkpoint taken before this turn started; the target of "Undo all of it". */
  readonly before: OrchestrationV2Checkpoint | null;
  /** Range for `getTurnDiff`; null when the engine recorded no turn ordinal. */
  readonly diffInput: Omit<OrchestrationGetTurnDiffInput, "ignoreWhitespace"> | null;
}

/** Scopes a non-developer should see: one per run, plus manual restore points. */
export function rootScopeIds(projection: OrchestrationV2ThreadProjection): ReadonlySet<string> {
  return new Set(
    projection.checkpointScopes
      .filter((scope) => scope.kind === "root_run" || scope.kind === "manual")
      .map((scope) => scope.id),
  );
}

function millis(checkpoint: OrchestrationV2Checkpoint): number {
  return DateTime.toEpochMillis(checkpoint.capturedAt);
}

/** The newest root checkpoint with file changes whose turn was not undone. */
export function latestReviewable(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2Checkpoint | undefined {
  const rolledBack = new Set(
    projection.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  return rootCheckpoints(projection).findLast(
    (c) => c.files.length > 0 && (c.runId === null || !rolledBack.has(c.runId)),
  );
}

/** Root checkpoints, oldest first. */
export function rootCheckpoints(
  projection: OrchestrationV2ThreadProjection,
): Array<OrchestrationV2Checkpoint> {
  const roots = rootScopeIds(projection);
  return projection.checkpoints
    .filter((checkpoint) => roots.has(checkpoint.scopeId))
    .sort((a, b) => millis(a) - millis(b) || a.ordinalWithinScope - b.ordinalWithinScope);
}

export function findBefore(
  projection: OrchestrationV2ThreadProjection,
  checkpoint: OrchestrationV2Checkpoint,
): OrchestrationV2Checkpoint | null {
  const byParent =
    checkpoint.parentCheckpointId === null
      ? undefined
      : projection.checkpoints.find((c) => c.id === checkpoint.parentCheckpointId);
  if (byParent) return byParent;
  const sameScope = projection.checkpoints.find(
    (c) =>
      c.scopeId === checkpoint.scopeId &&
      c.ordinalWithinScope === checkpoint.ordinalWithinScope - 1,
  );
  if (sameScope) return sameScope;
  const earlier = rootCheckpoints(projection).filter(
    (c) => c.id !== checkpoint.id && millis(c) <= millis(checkpoint),
  );
  return earlier.at(-1) ?? null;
}

export function reviewTargetFor(
  projection: OrchestrationV2ThreadProjection,
  threadId: ThreadId,
  checkpointId?: string,
): ReviewTarget | null {
  const checkpoint =
    checkpointId === undefined
      ? latestReviewable(projection)
      : projection.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) return null;
  const run = projection.runs.find((r) => r.id === checkpoint.runId) ?? null;
  const ordinal = checkpoint.appRunOrdinal;
  return {
    checkpoint,
    run,
    before: findBefore(projection, checkpoint),
    diffInput:
      ordinal === null
        ? null
        : { threadId, fromTurnCount: Math.max(0, ordinal - 1), toTurnCount: ordinal },
  };
}

/**
 * "Version N" numbering, oldest = 1, shared by the card and the rail so the
 * same point never carries two numbers. Live markers are not versions.
 */
export function numberVersions(entries: ReadonlyArray<VersionEntry>): ReadonlyMap<string, number> {
  const numbered = new Map<string, number>();
  const chronological = [...entries]
    .filter((entry) => entry.kind !== "live")
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  chronological.forEach((entry, index) => numbered.set(entry.id, index + 1));
  return numbered;
}
