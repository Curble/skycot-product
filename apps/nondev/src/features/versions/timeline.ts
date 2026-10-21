// The Versions timeline for one thread: engine checkpoints + versions kept from
// this app, numbered oldest-first, with the honest restore explainer.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { versions as copy } from "../../plain/copy";
import {
  buildVersionsTimeline,
  restoreExplainerFor,
  type RestoreExplainer,
  type VersionEntry,
} from "../../plain/versions";
import { environmentThreads } from "../../state/threads";
import { useKeptVersions } from "../review/keptVersions";
import { numberVersions, rootScopeIds } from "../review/turnReview";

export interface NumberedVersion extends VersionEntry {
  /** "Version N", oldest = 1. Live markers carry none. */
  readonly number: number | null;
}

export interface VersionsTimeline {
  readonly entries: ReadonlyArray<NumberedVersion>;
  readonly numbers: ReadonlyMap<string, number>;
  /** False while the thread works straight in the project folder, where the engine refuses to roll files back. */
  readonly canRollbackFiles: boolean;
}

/** True once the engine lets this thread roll files back: it has its own private copy. */
export function canRollbackFilesFor(
  shell: Pick<EnvironmentThreadShell, "worktreePath"> | null,
): boolean {
  return shell !== null && shell.worktreePath !== null;
}

export function buildTimeline(
  projection: OrchestrationV2ThreadProjection | null,
  shell: EnvironmentThreadShell | null,
  kept: ReadonlyArray<{
    readonly sha: string;
    readonly subject: string;
    readonly at: string;
    readonly fileCount?: number;
  }>,
): VersionsTimeline {
  const canRollbackFiles = canRollbackFilesFor(shell);
  if (projection === null) return { entries: [], numbers: new Map(), canRollbackFiles };
  const entries = buildVersionsTimeline(
    projection.checkpoints,
    { canRollbackFiles, commits: kept },
    { rootScopeIds: rootScopeIds(projection) },
  );
  const numbers = numberVersions(entries);
  return {
    entries: entries.map((entry) => ({ ...entry, number: numbers.get(entry.id) ?? null })),
    numbers,
    canRollbackFiles,
  };
}

export function useVersionsTimeline(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  shell: EnvironmentThreadShell | null,
): VersionsTimeline {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const kept = useKeptVersions(threadId);
  return buildTimeline(projection, shell, kept);
}

/**
 * What a restore really does on this engine. The shared copy promises a fresh
 * restore point before restoring; the engine does not take one (the points
 * after the target go stale instead), so that line is replaced with the truth.
 */
export function honestRestoreExplainer(blockedBecause?: string): RestoreExplainer {
  const base = restoreExplainerFor(blockedBecause);
  return {
    ...base,
    does: [
      copy.restoreDoes[0],
      "Keeps the whole conversation — what you asked for stays in the chat, so you can ask for it again.",
    ],
    doesNot: [
      ...base.doesNot.filter((line) => !line.startsWith("Doesn't delete the versions")),
      "Can't itself be undone: the points after this one stop being restorable.",
    ],
  };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "8:41 am" today, "Thu 8:41 am" this week, "9 Oct, 8:41 am" otherwise. */
export function formatVersionTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  if (sameDay(date, now)) return time;
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}
