// The Versions timeline for one thread: engine checkpoints + versions kept from
// this app, numbered oldest-first, with the honest restore explainer.
//
// Three truths the plain layer cannot see are applied here, so the card and
// the rail agree: a kept version is the same version as the point it was kept
// from (one number, one row); a point after an in-app restore is "undone",
// not "changed outside the app"; and restoring past a kept version is blocked,
// because the engine's rollback moves files but can never remove a Git commit.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { versions as copy } from "../../plain/copy";
import {
  buildVersionsTimeline,
  restoreExplainerFor,
  type VersionEntry,
} from "../../plain/versions";
import { useEffect } from "react";
import { environmentThreads } from "../../state/threads";
import { useKeptVersions, type KeptVersionRecord } from "../review/keptVersions";
import { numberVersions, rootScopeIds } from "../review/turnReview";
import {
  rememberUndonePoints,
  undonePointOf,
  useUndonePoints,
  type UndonePoint,
} from "./undonePoints";

export interface KeptMark {
  readonly sha: string;
  readonly subject: string;
}

export interface NumberedVersion extends VersionEntry {
  /** "Version N", oldest = 1. Live markers and loose kept versions carry none. */
  readonly number: number | null;
  /** Set when this point was also kept as a Git commit. */
  readonly kept: KeptMark | null;
  /** True when an in-app restore went back past this point. */
  readonly undone: boolean;
}

export interface VersionsTimeline {
  readonly entries: ReadonlyArray<NumberedVersion>;
  readonly numbers: ReadonlyMap<string, number>;
  /** Every decorated entry, including empty points the rail hides; keyed by checkpoint id. */
  readonly byId: ReadonlyMap<string, NumberedVersion>;
  /** False while the thread works straight in the project folder, where the engine refuses to roll files back. */
  readonly canRollbackFiles: boolean;
}

/** True once the engine lets this thread roll files back: it has its own private copy. */
export function canRollbackFilesFor(
  shell: Pick<EnvironmentThreadShell, "worktreePath"> | null,
): boolean {
  return shell !== null && shell.worktreePath !== null;
}

/** The engine marks points after a restore target "stale"; nothing else does. */
export const UNDONE_BLOCKER = copy.cannotRestoreStale;

export const START_LABEL = "Before any changes were made";

export function keptBlocker(kept: KeptMark, number: number | null): string {
  const name = number === null ? "A later version" : `Version ${number}`;
  return `${name} was kept as a Git commit (${kept.sha.slice(0, 7)}) after this point. Restoring past a kept version would hide what's already in the project's history, so it's blocked here. Ask the Crew to undo that change instead — it makes a new version that reverses it.`;
}

function withBlocker(entry: VersionEntry, blockedBecause: string): VersionEntry {
  const { restore: _restore, ...rest } = entry;
  return { ...rest, canRestore: false, restoreExplainer: restoreExplainerFor(blockedBecause) };
}

/**
 * Pure: decorates the plain entries with kept marks, truthful blockers and
 * numbers, then hides the empty restore points a non-developer never needs.
 * `kept` records that name a checkpoint fold into that checkpoint's row.
 */
export function decorateTimeline(
  plain: ReadonlyArray<VersionEntry>,
  kept: ReadonlyArray<KeptVersionRecord>,
): {
  readonly entries: ReadonlyArray<NumberedVersion>;
  readonly byId: ReadonlyMap<string, NumberedVersion>;
} {
  const keptByCheckpoint = new Map<string, KeptMark>();
  const foldedShas = new Set<string>();
  for (const record of kept) {
    if (record.checkpointId && plain.some((entry) => entry.id === record.checkpointId)) {
      keptByCheckpoint.set(record.checkpointId, { sha: record.sha, subject: record.subject });
      foldedShas.add(record.sha);
    }
  }

  // Oldest first for the "what came after this" questions.
  const decorated: Array<NumberedVersion> = [...plain]
    .filter((entry) => !(entry.kind === "kept version" && foldedShas.has(entry.id)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((entry) => {
      const undone = entry.restoreExplainer.blockedBecause === UNDONE_BLOCKER;
      return { ...entry, number: null, kept: keptByCheckpoint.get(entry.id) ?? null, undone };
    });

  // Hide empty restore points: keep only the oldest one, as the start line,
  // and only when something later actually changed files.
  const hasChanges = decorated.some(
    (entry) => entry.kind === "restore point" && entry.fileCount > 0,
  );
  let startKept = false;
  const visible: Array<NumberedVersion> = decorated
    .filter((entry) => {
      if (entry.kind !== "restore point" || entry.fileCount > 0) return true;
      if (!hasChanges || startKept) return false;
      startKept = true;
      return true;
    })
    .map((entry) =>
      entry.kind === "restore point" && entry.fileCount === 0
        ? { ...entry, label: START_LABEL }
        : entry,
    );

  // The project's state "now" is the newest ready point; if the engine's
  // current one was an empty point we hid, the newest visible ready point at
  // or before it holds the same files.
  if (!visible.some((entry) => entry.isCurrent)) {
    const engineCurrent = decorated.find((entry) => entry.isCurrent);
    if (engineCurrent) {
      for (let i = visible.length - 1; i >= 0; i -= 1) {
        const entry = visible[i]!;
        if (entry.kind !== "restore point" || entry.restoreExplainer.blockedBecause) continue;
        if (Date.parse(entry.timestamp) > Date.parse(engineCurrent.timestamp)) continue;
        visible[i] = {
          ...entry,
          isCurrent: true,
          canRestore: false,
          restoreExplainer: restoreExplainerFor(),
        };
        break;
      }
    }
  }

  const numbers = numberVersions(visible.filter((entry) => entry.kind === "restore point"));
  const numbered = visible.map((entry) => ({ ...entry, number: numbers.get(entry.id) ?? null }));

  // A kept version that still stands blocks every restore to a point before
  // it: the engine's rollback moves files but can never remove a commit.
  const standingKept = numbered.filter((entry) => entry.kept !== null && !entry.undone);
  const blockPastKept = (entry: NumberedVersion): NumberedVersion => {
    if (entry.kind !== "restore point" || !entry.canRestore) return entry;
    const later = standingKept.find(
      (candidate) =>
        candidate.id !== entry.id && Date.parse(candidate.timestamp) > Date.parse(entry.timestamp),
    );
    if (!later || later.kept === null) return entry;
    return {
      ...withBlocker(entry, keptBlocker(later.kept, later.number)),
      number: entry.number,
      kept: entry.kept,
      undone: entry.undone,
    };
  };
  const finished = numbered.map(blockPastKept);

  // Hidden empty points hold the same files as the nearest visible version
  // before them, so an Undo that lands on one is named after that version.
  const byId = new Map<string, NumberedVersion>();
  for (const entry of decorated) {
    const twin = finished.findLast(
      (candidate) =>
        candidate.kind === "restore point" &&
        candidate.number !== null &&
        Date.parse(candidate.timestamp) <= Date.parse(entry.timestamp),
    );
    // The alias also takes the twin's time: "Version 1 (20:07)" must read the
    // same in the Undo sheet as in the rail (QA-P2-3-01).
    const aliased =
      entry.kind === "restore point" && entry.fileCount === 0 && twin
        ? {
            ...blockPastKept(entry),
            number: twin.number,
            label: twin.label,
            timestamp: twin.timestamp,
          }
        : blockPastKept(entry);
    byId.set(entry.id, aliased);
  }
  for (const entry of finished) byId.set(entry.id, entry);
  // Newest first for the rail.
  return {
    entries: [...finished].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    byId,
  };
}

/** An undone point the engine has pruned, back as the "undone" row it was. */
function undoneEntry(point: UndonePoint): VersionEntry {
  return {
    id: point.id,
    kind: "restore point",
    kindLabel: copy.restorePoint,
    label: point.label,
    timestamp: point.timestamp,
    fileCount: point.fileCount,
    canRestore: false,
    restoreExplainer: restoreExplainerFor(UNDONE_BLOCKER),
    technical: point.technical,
    isCurrent: false,
  };
}

export function buildTimeline(
  projection: OrchestrationV2ThreadProjection | null,
  shell: EnvironmentThreadShell | null,
  kept: ReadonlyArray<KeptVersionRecord>,
  undone: ReadonlyArray<UndonePoint> = [],
): VersionsTimeline {
  const canRollbackFiles = canRollbackFilesFor(shell);
  if (projection === null) {
    return { entries: [], numbers: new Map(), byId: new Map(), canRollbackFiles };
  }
  const fromEngine = buildVersionsTimeline(
    projection.checkpoints,
    { canRollbackFiles, commits: kept },
    { rootScopeIds: rootScopeIds(projection) },
  );
  // Undone points keep their row and their number after the engine prunes them.
  const present = new Set(fromEngine.map((entry) => entry.id));
  const plain = [
    ...fromEngine,
    ...undone.filter((point) => !present.has(point.id)).map(undoneEntry),
  ];
  const { entries, byId } = decorateTimeline(plain, kept);
  const numbers = new Map<string, number>();
  for (const entry of entries) if (entry.number !== null) numbers.set(entry.id, entry.number);
  return { entries, numbers, byId, canRollbackFiles };
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
  const undone = useUndonePoints(threadId);
  const timeline = buildTimeline(projection, shell, kept, undone);
  const newlyUndone = timeline.entries
    .filter(
      (entry) => entry.undone && entry.fileCount > 0 && !undone.some((p) => p.id === entry.id),
    )
    .map(undonePointOf);
  useEffect(() => {
    if (newlyUndone.length > 0) rememberUndonePoints(threadId, newlyUndone);
  }, [threadId, newlyUndone]);
  return timeline;
}

/**
 * The confirmation line for a restore or undo. Version numbers, not times,
 * because two points often share a minute.
 */
export function restoreSentence(
  intent: "undo" | "restore",
  versionNumber: number | null | undefined,
  when: string,
): string {
  const target = versionNumber ? `Version ${versionNumber} (${when})` : `this point (${when})`;
  return intent === "undo"
    ? `Files go back to how they were at ${target}. Everything this step changed is undone; the chat keeps it so you can ask again.`
    : `Files go back to how they were at ${target}. Changes made after that point are undone; they stay in the chat.`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "8:41 am" today, "Thu 8:41 am" this week, "9 Oct, 8:41 am" otherwise. */
export function timelineTitle(number: number | null, label: string, childView: boolean): string {
  if (number === null) return label;
  return childView ? `Try ${number}` : `Version ${number}`;
}

export function timelineLabel(label: string, childView: boolean): string {
  return childView ? label.replace(/\s*\(\+\d+ \/ −\d+ lines?\)$/, "") : label;
}

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
