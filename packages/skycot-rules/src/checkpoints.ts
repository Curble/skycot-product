// Checkpoint facts shared by the plain client (the "What changed" card, stickers) and the
// engine's Family features (the fridge, the recap): which earlier save a turn's changes are
// measured from, and the files a unified diff names. Pure; no engine types.

export interface SpanCheckpoint {
  readonly id: string;
  readonly scopeId: string;
  readonly runId: string | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
}

export interface SpanRun {
  readonly id: string;
  readonly status: string;
}

export interface RetrySpan<C extends SpanCheckpoint> {
  /** `fromTurnCount` for the engine's turn diff. */
  readonly fromTurnCount: number;
  /** The save from before the failed turn: where "Undo all of it" goes back to. */
  readonly before: C | null;
}

/**
 * A turn that fails part-way (the AI's allowance ran out, the connection dropped) saves no
 * checkpoint, yet its files stay changed. The engine then saves a plain "before" at the
 * start of the next turn, so the retry measures its changes from a folder that already holds
 * the failed turn's page and usually shows nothing. This finds that case: the checkpoint's
 * own "before" belongs to no turn and is not the conversation's very first save. The span
 * then runs back to the last turn that finished and saved (or the conversation's start), so
 * the retry's card, its Open it, the fridge, the recap and the stickers see the whole page.
 *
 * Null for every ordinary turn, which keeps measuring from its own "before". Also null when
 * the last saved turn did not finish (stopped), because the engine's turn diff cannot start
 * there.
 */
export function retrySpan<C extends SpanCheckpoint>(
  checkpoints: ReadonlyArray<C>,
  runs: ReadonlyArray<SpanRun>,
  checkpoint: SpanCheckpoint,
): RetrySpan<C> | null {
  if (checkpoint.runId === null || checkpoint.appRunOrdinal === null) return null;
  const sameScope = checkpoints.filter((candidate) => candidate.scopeId === checkpoint.scopeId);
  const parent = sameScope.find(
    (candidate) => candidate.ordinalWithinScope === checkpoint.ordinalWithinScope - 1,
  );
  if (parent === undefined || parent.runId !== null || parent.ordinalWithinScope === 0) {
    return null;
  }
  const lastSavedTurn = sameScope
    .filter(
      (candidate) =>
        candidate.runId !== null && candidate.ordinalWithinScope < checkpoint.ordinalWithinScope,
    )
    .sort((a, b) => b.ordinalWithinScope - a.ordinalWithinScope)[0];
  if (lastSavedTurn === undefined) {
    return {
      fromTurnCount: 0,
      before: sameScope.find((candidate) => candidate.ordinalWithinScope === 0) ?? null,
    };
  }
  const run = runs.find((candidate) => candidate.id === lastSavedTurn.runId);
  if (run?.status !== "completed" || lastSavedTurn.appRunOrdinal === null) return null;
  return { fromTurnCount: lastSavedTurn.appRunOrdinal, before: lastSavedTurn };
}

export type DiffFileOperation = "added" | "edited" | "deleted" | "renamed";

export interface DiffFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly operation: DiffFileOperation;
  readonly additions: number;
  readonly deletions: number;
  readonly binary?: boolean;
}

/**
 * Reads a unified diff (the engine's `getTurnDiff` / `getFullThreadDiff` text) into per-file
 * changes. Tolerant: unknown headers are skipped, binary files count as a change with no
 * line numbers.
 */
export function parseUnifiedDiff(diff: string): Array<DiffFile> {
  const files: Array<{
    path: string;
    oldPath?: string;
    operation: DiffFileOperation;
    additions: number;
    deletions: number;
    binary: boolean;
  }> = [];
  let current: (typeof files)[number] | undefined;
  for (const rawLine of diff.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(rawLine);
    if (header) {
      const oldPath = header[1]!;
      const path = header[2]!;
      current = {
        path,
        operation: "edited",
        additions: 0,
        deletions: 0,
        binary: false,
        ...(oldPath !== path ? { oldPath, operation: "renamed" as const } : {}),
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("new file mode")) current.operation = "added";
    else if (rawLine.startsWith("deleted file mode")) current.operation = "deleted";
    else if (rawLine.startsWith("rename from ")) {
      current.operation = "renamed";
      current.oldPath = rawLine.slice("rename from ".length);
    } else if (rawLine.startsWith("rename to ")) current.path = rawLine.slice("rename to ".length);
    else if (rawLine.startsWith("Binary files ") || rawLine.startsWith("GIT binary patch"))
      current.binary = true;
    else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) current.additions += 1;
    else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) current.deletions += 1;
  }
  return files.map(({ binary, ...file }) => (binary ? { ...file, binary } : file));
}
