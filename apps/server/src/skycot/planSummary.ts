// nondev-seam: skycot-plan-really-waiting
// The engine's SQL thread list pre-filters "is a plan waiting?" with "some plan is active", which
// stays true for a plan that was built, stopped, replaced or taken back. This file applies the one
// shared rule (@t3tools/skycot-rules/plans `planWaitingForBuild`) to just those flagged threads, so
// "Your plan is ready" shows only when Build it is really on offer. Display only: it can turn the
// flag from true to false, never the other way, and it changes no permission, approval or hold.
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import { planWaitingForBuild } from "@t3tools/skycot-rules/plans";

const CHUNK = 400;

type FlaggedRow = { readonly thread_id: string; readonly has_actionable_proposed_plan: number };

/** Thread ids (of those given) whose plan is really waiting for Build it. */
export const threadsReallyWaitingForBuild = Effect.fn("skycot.threadsReallyWaitingForBuild")(
  function* (sql: SqlClient.SqlClient, threadIds: ReadonlyArray<string>) {
    const waiting = new Set<string>();
    for (let start = 0; start < threadIds.length; start += CHUNK) {
      const ids = threadIds.slice(start, start + CHUNK);
      const [plans, items, runs] = yield* Effect.all([
        sql<{
          thread_id: string;
          plan_id: string;
          run_id: string | null;
          kind: string;
          status: string;
        }>`
          SELECT thread_id, plan_id, run_id, kind, status
          FROM orchestration_v2_projection_plans
          WHERE thread_id IN ${sql.in(ids)}`,
        sql<{
          thread_id: string;
          type: string;
          ordinal: number;
          plan_id: string | null;
          completed_at: string | null;
          updated_at: string;
        }>`
          SELECT thread_id, type, ordinal, updated_at,
            json_extract(payload_json, '$.planId') AS plan_id,
            json_extract(payload_json, '$.completedAt') AS completed_at
          FROM orchestration_v2_projection_turn_items
          WHERE thread_id IN ${sql.in(ids)} AND type = 'proposed_plan'`,
        sql<{
          thread_id: string;
          run_id: string;
          status: string;
          started_at: string | null;
          source_plan_id: string | null;
        }>`
          SELECT thread_id, run_id, status,
            json_extract(payload_json, '$.startedAt') AS started_at,
            json_extract(payload_json, '$.sourcePlanRef.planId') AS source_plan_id
          FROM orchestration_v2_projection_runs
          WHERE thread_id IN ${sql.in(ids)}`,
      ]);
      for (const threadId of ids) {
        const reallyWaiting = planWaitingForBuild({
          plans: plans
            .filter((row) => row.thread_id === threadId)
            .map((row) => ({
              id: row.plan_id,
              kind: row.kind,
              status: row.status,
              runId: row.run_id,
            })),
          turnItems: items
            .filter((row) => row.thread_id === threadId)
            .map((row) => ({
              type: row.type,
              ordinal: row.ordinal,
              planId: row.plan_id ?? undefined,
              completedAt: row.completed_at,
              updatedAt: row.updated_at,
            })),
          runs: runs
            .filter((row) => row.thread_id === threadId)
            .map((row) => ({
              id: row.run_id,
              status: row.status,
              startedAt: row.started_at,
              sourcePlanRef:
                row.source_plan_id === null ? undefined : { planId: row.source_plan_id },
            })),
        });
        if (reallyWaiting) waiting.add(threadId);
      }
    }
    return waiting;
  },
);

/** Clears `has_actionable_proposed_plan` on shell rows whose active plan is not really waiting. */
export const applyPlanReallyWaiting = Effect.fn("skycot.applyPlanReallyWaiting")(function* <
  Row extends FlaggedRow,
>(sql: SqlClient.SqlClient, rows: ReadonlyArray<Row>) {
  const flagged = rows.filter((row) => row.has_actionable_proposed_plan === 1);
  if (flagged.length === 0) return rows;
  const waiting = yield* threadsReallyWaitingForBuild(
    sql,
    flagged.map((row) => row.thread_id),
  );
  return rows.map((row) =>
    row.has_actionable_proposed_plan === 1 && !waiting.has(row.thread_id)
      ? { ...row, has_actionable_proposed_plan: 0 }
      : row,
  );
});
