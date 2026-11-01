// nondev-seam: skycot-plan-really-waiting-test
import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerTest = Layer.mergeAll(
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  SqlitePersistence.layerMemory,
);
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.4" };
const driver = ProviderDriverKind.make("codex");

type Scenario = "built" | "replaced" | "waiting";

const seed = Effect.fn("seedPlanThread")(function* (scenario: Scenario) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const later = DateTime.add(now, { seconds: 30 });
  const threadId = ThreadId.make(`thread:plan:${scenario}`);
  const nodeId = NodeId.make(`node:plan:${scenario}`);
  let seq = 0;
  const eid = () => EventId.make(`event:plan:${scenario}:${seq++}`);
  yield* store.apply({
    id: eid(),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make(`project:plan:${scenario}`),
      title: "Plan thread",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  const makeRun = (n: number, extra: Record<string, unknown>, startedAt = now) => ({
    id: RunId.make(`run:plan:${scenario}:${n}`),
    threadId,
    ordinal: n,
    providerInstanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:plan:${scenario}:${n}`),
    rootNodeId: nodeId,
    activeAttemptId: null,
    status: "completed" as const,
    requestedAt: startedAt,
    startedAt,
    completedAt: startedAt,
    checkpointId: null,
    contextHandoffId: null,
    ...extra,
  });
  const addRun = (run: ReturnType<typeof makeRun>) =>
    store.apply({
      id: eid(),
      type: "run.created",
      threadId,
      runId: run.id,
      nodeId,
      driver,
      providerInstanceId,
      occurredAt: now,
      payload: run,
    });
  const addPlan = (n: number, runId: RunId, at: DateTime.Utc) =>
    Effect.gen(function* () {
      const planId = PlanId.make(`plan:plan:${scenario}:${n}`);
      yield* store.apply({
        id: eid(),
        type: "plan.updated",
        threadId,
        runId,
        occurredAt: at,
        payload: {
          id: planId,
          threadId,
          runId,
          nodeId,
          kind: "proposed_plan",
          status: "active",
          markdown: `Plan ${n}`,
        },
      });
      yield* store.apply({
        id: eid(),
        type: "turn-item.updated",
        threadId,
        runId,
        nodeId,
        driver,
        occurredAt: at,
        payload: {
          id: TurnItemId.make(`item:plan:${scenario}:${n}`),
          threadId,
          runId,
          nodeId,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: n,
          status: "completed",
          title: "Plan",
          startedAt: at,
          completedAt: at,
          updatedAt: at,
          type: "proposed_plan",
          planId,
          markdown: `Plan ${n}`,
          streaming: false,
        },
      });
      return planId;
    });

  const first = makeRun(1, {});
  yield* addRun(first);
  const planOne = yield* addPlan(1, first.id, now);
  if (scenario === "built") {
    yield* addRun(makeRun(2, { sourcePlanRef: { threadId, planId: planOne } }, later));
  } else if (scenario === "replaced") {
    const second = makeRun(2, {}, later);
    yield* addRun(second);
    yield* addPlan(2, second.id, later);
    // The newer plan was built too, so no plan is waiting at all.
    const third = makeRun(3, {}, DateTime.add(later, { seconds: 30 }));
    yield* addRun({
      ...third,
      sourcePlanRef: { threadId, planId: PlanId.make(`plan:plan:${scenario}:2`) },
    } as typeof third);
  }
  return threadId;
});

it.effect("SQL shells say a plan is ready only when Build it is really on offer", () =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const expected: Record<Scenario, boolean> = { built: false, replaced: false, waiting: true };
    for (const scenario of ["built", "replaced", "waiting"] as const) {
      const threadId = yield* seed(scenario);
      const single = yield* store.getThreadShell(threadId);
      assert.equal(single?.hasActionableProposedPlan, expected[scenario], `single ${scenario}`);
    }
    // Read twice: the list path agrees, and repeating the read changes nothing.
    for (let pass = 0; pass < 2; pass++) {
      const listed = (yield* store.getShellSnapshot()).threads;
      for (const scenario of ["built", "replaced", "waiting"] as const) {
        const row = listed.find((thread) => thread.id === `thread:plan:${scenario}`);
        assert.equal(row?.hasActionableProposedPlan, expected[scenario], `list ${scenario}`);
      }
    }
  }).pipe(Effect.provide(layerTest)),
);
