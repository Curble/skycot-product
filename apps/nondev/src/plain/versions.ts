import type {
  CheckpointId,
  CheckpointScopeId,
  OrchestrationV2Checkpoint,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { describeChanges, fromCheckpointFiles } from "./changes";
import { versions as copy } from "./copy";

export type VersionKind = "restore point" | "kept version" | "live";

export interface RestoreExplainer {
  readonly does: ReadonlyArray<string>;
  readonly doesNot: ReadonlyArray<string>;
  /** Set when restore is unavailable: the one-line reason. */
  readonly blockedBecause?: string;
}

export interface VersionEntry {
  readonly id: string;
  readonly kind: VersionKind;
  readonly kindLabel: string;
  /** Plain change note, e.g. "Changed 3 files: 2 pages and 1 style file". */
  readonly label: string;
  /** ISO-8601, so the UI formats it for the viewer's locale. */
  readonly timestamp: string;
  readonly fileCount: number;
  readonly canRestore: boolean;
  readonly restoreExplainer: RestoreExplainer;
  /** The payload for `checkpoint.rollback` (minus commandId / threadId). Absent for commits and live markers. */
  readonly restore?: {
    readonly type: "checkpoint.rollback";
    readonly scopeId: CheckpointScopeId;
    readonly checkpointId: CheckpointId;
    readonly restoreFiles: true;
  };
  readonly technical: string;
  readonly isCurrent: boolean;
}

export interface KeptVersion {
  readonly sha: string;
  readonly subject: string;
  /** ISO-8601 */
  readonly at: string;
  readonly fileCount?: number;
}

export interface LiveMarker {
  readonly id: string;
  readonly label: string;
  /** ISO-8601 */
  readonly at: string;
  readonly url?: string;
}

export interface VersionsContext {
  /** False when the thread runs in the project's main folder, where files can't be rolled back. */
  readonly canRollbackFiles?: boolean;
  readonly commits?: ReadonlyArray<KeptVersion>;
  readonly live?: ReadonlyArray<LiveMarker>;
}

function isoOf(value: DateTime.Utc | string): string {
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

function restoreBlocker(
  checkpoint: OrchestrationV2Checkpoint,
  ctx: VersionsContext,
): string | undefined {
  if (ctx.canRollbackFiles === false) return copy.cannotRestoreShared;
  switch (checkpoint.status) {
    case "missing":
    case "error":
      return copy.cannotRestoreMissing;
    case "stale":
      return copy.cannotRestoreStale;
    case "ready":
      return undefined;
  }
}

export function restoreExplainerFor(blockedBecause?: string): RestoreExplainer {
  return {
    does: copy.restoreDoes,
    doesNot: copy.restoreDoesNot,
    ...(blockedBecause ? { blockedBecause } : {}),
  };
}

export function describeCheckpoint(
  checkpoint: OrchestrationV2Checkpoint,
  ctx: VersionsContext = {},
  isCurrent = false,
): VersionEntry {
  const changes = describeChanges(fromCheckpointFiles(checkpoint.files));
  const blocker = restoreBlocker(checkpoint, ctx);
  const canRestore = blocker === undefined && !isCurrent;
  return {
    id: checkpoint.id,
    kind: "restore point",
    kindLabel: copy.restorePoint,
    label:
      checkpoint.files.length === 0
        ? "No file changes at this point"
        : changes.summary.replace(/\.$/, ""),
    timestamp: isoOf(checkpoint.capturedAt),
    fileCount: checkpoint.files.length,
    canRestore,
    restoreExplainer: restoreExplainerFor(isCurrent ? undefined : blocker),
    ...(blocker === undefined
      ? {
          restore: {
            type: "checkpoint.rollback" as const,
            scopeId: checkpoint.scopeId,
            checkpointId: checkpoint.id,
            restoreFiles: true as const,
          },
        }
      : {}),
    technical: `checkpoint ${checkpoint.ref} (${checkpoint.status}, #${checkpoint.ordinalWithinScope} in scope ${checkpoint.scopeId})`,
    isCurrent,
  };
}

export function describeKeptVersion(commit: KeptVersion): VersionEntry {
  return {
    id: commit.sha,
    kind: "kept version",
    kindLabel: copy.keptVersion,
    label: commit.subject,
    timestamp: commit.at,
    fileCount: commit.fileCount ?? 0,
    canRestore: false,
    restoreExplainer: restoreExplainerFor(
      "Kept versions are restored from a restore point next to them, not directly.",
    ),
    technical: `git commit ${commit.sha.slice(0, 10)}`,
    isCurrent: false,
  };
}

export function describeLiveMarker(marker: LiveMarker): VersionEntry {
  return {
    id: marker.id,
    kind: "live",
    kindLabel: copy.live,
    label: marker.label,
    timestamp: marker.at,
    fileCount: 0,
    canRestore: false,
    restoreExplainer: restoreExplainerFor(
      "What's live is changed by a new review, not by restoring.",
    ),
    technical: marker.url ?? marker.id,
    isCurrent: false,
  };
}

/**
 * Builds the Versions timeline, newest first. Only root-run checkpoints appear (tool and
 * subagent scopes are noise to a non-developer). The newest ready checkpoint is "current" and
 * can't be restored to itself.
 */
export function buildVersionsTimeline(
  checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>,
  ctx: VersionsContext = {},
  options: { readonly rootScopeIds?: ReadonlySet<string> } = {},
): Array<VersionEntry> {
  const visible = options.rootScopeIds
    ? checkpoints.filter((c) => options.rootScopeIds!.has(c.scopeId))
    : checkpoints;
  const sorted = [...visible].sort(
    (a, b) =>
      DateTime.toEpochMillis(b.capturedAt) - DateTime.toEpochMillis(a.capturedAt) ||
      b.ordinalWithinScope - a.ordinalWithinScope,
  );
  const currentId = sorted.find((c) => c.status === "ready")?.id;
  const entries: Array<VersionEntry> = [
    ...sorted.map((checkpoint) => describeCheckpoint(checkpoint, ctx, checkpoint.id === currentId)),
    ...(ctx.commits ?? []).map(describeKeptVersion),
    ...(ctx.live ?? []).map(describeLiveMarker),
  ];
  return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/** The confirmation line under the Restore button: "You'll lose changes made after …". */
export function restoreConfirmation(
  entry: VersionEntry,
  formatTime: (iso: string) => string,
): string {
  return copy.youWillLose(formatTime(entry.timestamp));
}
