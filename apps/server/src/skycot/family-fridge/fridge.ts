// The family fridge, pure part: every conversation that made a page, as one magnet each.
// What is "made" is read from the checkpoints (the newest kept change that touched a page);
// the only thing the fridge stores is which magnets are pinned. Taking one down never deletes
// a file: the page stays in its project and the conversation stays in the list.
import { pageOf, type RecapFile } from "../family-recap/recap.ts";

export interface FridgeThread {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly deleted: boolean;
  readonly checkpoints: ReadonlyArray<{
    readonly runId: string | null;
    readonly capturedAt: number;
    readonly files: ReadonlyArray<RecapFile>;
  }>;
  readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
}

export interface FridgeItem {
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  /** The child who started it; null outside the Family profile or for older work. */
  readonly childId: string | null;
  readonly madeAt: number;
  readonly page: string;
  readonly cwd: string;
  readonly pinnedAt: number | null;
}

/** One magnet per conversation that made a page, newest first. */
export function fridgeItems(
  threads: ReadonlyArray<FridgeThread>,
  owners: Readonly<Record<string, string>>,
  pins: Readonly<Record<string, number>>,
): Array<FridgeItem> {
  const items: Array<FridgeItem> = [];
  for (const thread of threads) {
    if (thread.deleted || thread.cwd === null) continue;
    const undone = new Set(
      thread.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
    );
    const latest = [...thread.checkpoints]
      .filter(
        (checkpoint) =>
          (checkpoint.runId === null || !undone.has(checkpoint.runId)) &&
          pageOf(checkpoint.files) !== null,
      )
      .sort((a, b) => b.capturedAt - a.capturedAt)[0];
    if (latest === undefined) continue;
    items.push({
      threadId: thread.threadId,
      projectId: thread.projectId,
      title: thread.title,
      childId: owners[thread.threadId] ?? null,
      madeAt: latest.capturedAt,
      page: pageOf(latest.files)!,
      cwd: thread.cwd,
      pinnedAt: pins[thread.threadId] ?? null,
    });
  }
  return items.sort((a, b) => b.madeAt - a.madeAt);
}
