// "That's not what I meant": change an earlier message and go back to there. The plain rules,
// kept pure so they can be tested without the engine.
//
// Going back is the engine's own rollback (`checkpoint.rollback`, the command Undo and the
// Versions rail use): it takes the conversation back to the restore point captured just
// before the message, marks every later run "rolled back" (the assistant forgets them), and
// with `restoreFiles` also puts the conversation's private copy back to that point. The
// changed message is then sent like any new one, so plan first, Ask me first, the shield and
// the Family limits all apply to it.
import type {
  CheckpointId,
  CheckpointScopeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  RunId,
} from "@t3tools/contracts";

import { readExplainMarker } from "@t3tools/skycot-rules/explain";
import { readPointing } from "@t3tools/skycot-rules/preview";

type UserMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;

export type RewindProjection = Pick<
  OrchestrationV2ThreadProjection,
  "runs" | "checkpoints" | "checkpointScopes" | "thread"
>;

/** Runs that have started and still count in the conversation. */
const LIVE_STARTED: ReadonlySet<OrchestrationV2Run["status"]> = new Set<
  OrchestrationV2Run["status"]
>(["starting", "running", "waiting", "completed", "interrupted", "failed", "cancelled"]);

function runOf(runs: ReadonlyArray<OrchestrationV2Run>, item: OrchestrationV2TurnItem) {
  return item.runId === null ? undefined : runs.find((run) => run.id === item.runId);
}

/**
 * Whether a message gets the Edit action at all: the person's own request that started a
 * turn, still part of the conversation. A note added while the crew worked joined someone
 * else's turn, and a message still lined up has nothing to go back to yet.
 */
export function canOfferEdit(
  item: OrchestrationV2TurnItem,
  runs: ReadonlyArray<OrchestrationV2Run>,
): item is UserMessage {
  if (item.type !== "user_message") return false;
  if (item.inputIntent !== "turn_start" && item.inputIntent !== "queued_turn") return false;
  const run = runOf(runs, item);
  return run !== undefined && LIVE_STARTED.has(run.status);
}

export type RewindBlock =
  /** This connection can read but not change anything. */
  | "read-only"
  /** The message was already replaced (the conversation went back past it). */
  | "gone"
  /** The conversation is put away: bring it back first. */
  | "put-away"
  /** The crew is working (or waiting on an answer): stop first. */
  | "working"
  /** The AI service cannot go back in a conversation. */
  | "no-rollback"
  /** A different AI service took over after this point. */
  | "switched-assistant"
  /** The restore point from before this message no longer exists. */
  | "too-old";

export interface RewindTarget {
  readonly checkpointId: CheckpointId;
  readonly scopeId: CheckpointScopeId;
  /** The edited message's run: once the engine marks it rolled back, going back is done. */
  readonly witnessRunId: RunId;
  /** How many of the person's messages (this one included) are replaced. */
  readonly replacedMessages: number;
  /** Distinct files the crew changed from this message on: what "Put the files back" moves. */
  readonly filesChanged: number;
}

export type RewindCheck =
  | { readonly ok: true; readonly target: RewindTarget }
  | { readonly ok: false; readonly block: RewindBlock };

function rootScopeIds(projection: Pick<RewindProjection, "checkpointScopes">): ReadonlySet<string> {
  return new Set(
    projection.checkpointScopes
      .filter((scope) => scope.kind === "root_run" || scope.kind === "manual")
      .map((scope) => scope.id),
  );
}

/** The restore point captured at the end of `run` (or at the start of the conversation). */
function restorePointBefore(
  projection: RewindProjection,
  previous: OrchestrationV2Run | undefined,
): OrchestrationV2Checkpoint | undefined {
  const roots = rootScopeIds(projection);
  const ready = projection.checkpoints.filter(
    (checkpoint) => checkpoint.status === "ready" && roots.has(checkpoint.scopeId),
  );
  if (previous === undefined) {
    return ready.findLast(
      (checkpoint) => checkpoint.ordinalWithinScope === 0 && checkpoint.appRunOrdinal === null,
    );
  }
  return (
    ready.find((checkpoint) => checkpoint.id === previous.checkpointId) ??
    ready.findLast((checkpoint) => checkpoint.appRunOrdinal === previous.ordinal)
  );
}

/**
 * Where "Go back to here" lands for `item`, or the one reason it can't. Checked when Edit is
 * pressed and again just before going back, since the conversation can move in between.
 */
export function rewindCheck(input: {
  readonly projection: RewindProjection;
  readonly item: UserMessage;
  readonly canOperate: boolean;
  readonly archived: boolean;
  readonly active: boolean;
  /** False when the AI service says it cannot roll a conversation back. */
  readonly supportsRollback: boolean;
}): RewindCheck {
  const { projection, item } = input;
  if (!input.canOperate) return { ok: false, block: "read-only" };
  const run = runOf(projection.runs, item);
  if (run === undefined || !canOfferEdit(item, projection.runs))
    return { ok: false, block: "gone" };
  if (input.archived) return { ok: false, block: "put-away" };
  if (input.active) return { ok: false, block: "working" };
  if (!input.supportsRollback) return { ok: false, block: "no-rollback" };

  // Ordinals follow start order (a queued run takes a new one when it starts).
  const live = projection.runs
    .filter((candidate) => LIVE_STARTED.has(candidate.status))
    .sort((a, b) => a.ordinal - b.ordinal);
  const previous = live.findLast((candidate) => candidate.ordinal < run.ordinal);
  const activeProviderThreadId = projection.thread.activeProviderThreadId;
  if (
    activeProviderThreadId !== null &&
    [previous, run].some(
      (candidate) =>
        candidate !== undefined &&
        candidate.providerThreadId !== null &&
        candidate.providerThreadId !== activeProviderThreadId,
    )
  ) {
    return { ok: false, block: "switched-assistant" };
  }
  const point = restorePointBefore(projection, previous);
  if (point === undefined) return { ok: false, block: "too-old" };

  const replaced = live.filter((candidate) => candidate.ordinal >= run.ordinal);
  const replacedIds = new Set(replaced.map((candidate) => candidate.id));
  const roots = rootScopeIds(projection);
  const files = new Set(
    projection.checkpoints
      .filter(
        (checkpoint) =>
          checkpoint.runId !== null &&
          replacedIds.has(checkpoint.runId) &&
          roots.has(checkpoint.scopeId) &&
          checkpoint.status !== "stale",
      )
      .flatMap((checkpoint) => checkpoint.files.map((file) => file.path)),
  );
  return {
    ok: true,
    target: {
      checkpointId: point.id,
      scopeId: point.scopeId,
      witnessRunId: run.id,
      replacedMessages: replaced.length,
      filesChanged: files.size,
    },
  };
}

export type FilesChoice =
  /** Nothing changed after the message: there is nothing to put back. */
  | { readonly kind: "nothing" }
  | { readonly kind: "choose" }
  /** Only "Keep the files as they are": the reason "Put the files back" can't be used. */
  | { readonly kind: "keep-only"; readonly because: string };

/**
 * Whether "Put the files back too" is on offer. It is the same rollback as Undo, so it is
 * refused where Undo is: a conversation working straight in the project's folder (the engine
 * refuses), and past a version kept as a Git commit (the Versions rail's blocker).
 */
export function filesChoice(input: {
  readonly filesChanged: number;
  readonly worksInPrivateCopy: boolean;
  /** The Versions rail's reason it can't restore to the target point, if any. */
  readonly versionBlocker: string | null;
}): FilesChoice {
  if (input.filesChanged === 0) return { kind: "nothing" };
  if (!input.worksInPrivateCopy) return { kind: "keep-only", because: copy.sharedFolder };
  if (input.versionBlocker !== null) return { kind: "keep-only", because: input.versionBlocker };
  return { kind: "choose" };
}

/** Did the engine finish going back (or say why not)? Read from the live projection. */
export function rewindProgress(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "thread">,
  pending: { readonly commandId: string; readonly witnessRunId: RunId },
): "waiting" | "done" | { readonly failed: string } {
  const failure = projection.thread.rollbackFailure;
  if (failure && failure.requestId === pending.commandId) return { failed: failure.message };
  const witness = projection.runs.find((run) => run.id === pending.witnessRunId);
  return witness?.status === "rolled_back" ? "done" : "waiting";
}

/** Rolled-back runs, for the stream's "went back" fold and the plan card. */
export function rolledBackRunIds(runs: ReadonlyArray<OrchestrationV2Run>): ReadonlySet<string> {
  return new Set(runs.filter((run) => run.status === "rolled_back").map((run) => run.id));
}

export interface FoldableEntry {
  readonly kind: string;
  readonly runId: RunId | null;
}

export interface TakenBack<Entry> {
  readonly kind: "taken-back";
  readonly key: string;
  readonly entries: ReadonlyArray<Entry>;
}

/**
 * Folds what a "go back" replaced into one quiet row. A stretch of entries from rolled-back
 * runs folds only once the conversation carried on after it; until then (straight after an
 * Undo) it stays open, where its "Undone" card says what happened.
 */
export function foldTakenBack<Entry extends FoldableEntry>(
  entries: ReadonlyArray<Entry>,
  rolledBack: ReadonlySet<string>,
): Array<Entry | TakenBack<Entry>> {
  const out: Array<Entry | TakenBack<Entry>> = [];
  let stretch: Array<Entry> = [];
  const flush = (carriedOn: boolean) => {
    if (stretch.length === 0) return;
    if (carriedOn) {
      out.push({ kind: "taken-back", key: `taken-back:${out.length}`, entries: stretch });
    } else {
      out.push(...stretch);
    }
    stretch = [];
  };
  for (const entry of entries) {
    if (entry.runId !== null && rolledBack.has(entry.runId)) {
      stretch.push(entry);
      continue;
    }
    flush(entry.runId !== null);
    out.push(entry);
  }
  flush(false);
  return out;
}

/** What the sheet says will be replaced. */
export function countReplaced(
  target: Pick<RewindTarget, "replacedMessages">,
  crewName: string,
): string {
  const later = target.replacedMessages - 1;
  if (later <= 0) return `${crewName}'s reply to it will be replaced.`;
  return later === 1
    ? `This message and the next one, with ${crewName}'s replies, will be replaced.`
    : `This message and the ${later} after it, with ${crewName}'s replies, will be replaced.`;
}

export const copy = {
  sharedFolder:
    "This conversation works straight in your project's folder, so its files can't be put back here. Keep the files as they are, or ask for the change in your message.",
  blocked: (block: RewindBlock, crewName: string): { title: string; body: string } => {
    switch (block) {
      case "read-only":
        return {
          title: "Can't change messages here",
          body: "This connection can read the conversation but not change it.",
        };
      case "gone":
        return {
          title: "That message was already replaced",
          body: "The conversation went back past it. Type what you want in a new message instead.",
        };
      case "put-away":
        return {
          title: "Bring the conversation back first",
          body: "This conversation is put away. Bring it back, then change your message.",
        };
      case "working":
        return {
          title: `${crewName} is still working`,
          body: `${crewName} is busy with this conversation. Stop ${crewName} first, then change your message.`,
        };
      case "no-rollback":
        return {
          title: "This AI can't go back",
          body: "The AI service in this conversation can't go back to an earlier message. Start a new conversation, or say what's different in a new message.",
        };
      case "switched-assistant":
        return {
          title: "Can't go back that far",
          body: "A different AI service took over after this message, so SKYCOT can't go back to before it. Say what's different in a new message instead.",
        };
      case "too-old":
        return {
          title: "Can't go back that far",
          body: `SKYCOT no longer has the saved point from just before this message, so it can't go back to there. Nothing was changed. You can still ask ${crewName} for something different in a new message.`,
        };
    }
  },
} as const;

/**
 * The words that go back in the box: what the person typed, without the markers SKYCOT adds
 * for the engine (explain mode, what was pointed at in the preview).
 */
export function editableText(text: string): {
  readonly text: string;
  readonly pointedAt: number;
} {
  const pointing = readPointing(readExplainMarker(text).text);
  return { text: pointing.text, pointedAt: pointing.labels.length };
}
