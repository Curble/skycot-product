// The fallback against the real engine (the same in-memory runtime upstream's runtimeLayer tests
// build): a turn a usage limit stopped is carried on once with the fallback model, through the
// engine's own manual-continuation path, and upstream's scheduled resume for the same run is then
// refused, so the turn never runs twice. And a message that waited in the queue behind that turn
// starts on the fallback too, through the engine's queued-turn question (queuedTurn.ts), so it
// never fails once on the resting model first.
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type ModelSelection,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../../config.ts";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import * as McpSessionRegistryTestkit from "../../mcp/McpSessionRegistry.testkit.ts";
import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../../orchestration-v2/EffectOutbox.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../../orchestration-v2/runtimeLayer.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import { limitRecoveryCommand } from "../../orchestration-v2/UsageLimitRecoveryWorker.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as SourceControlProviderRegistry from "../../sourceControl/SourceControlProviderRegistry.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { provider, window } from "./fixtures.test-helpers.ts";
import * as SkycotQueuedTurn from "./queuedTurn.ts";
import { SWITCH_MESSAGE_PREFIX, makeFallback } from "./SkycotModelFallback.ts";
import { makeMemorySwitchStore } from "./switchLog.ts";

const instanceId = ProviderInstanceId.make("codex");
const chosen = { instanceId, model: "gpt-6-astra" } satisfies ModelSelection;
const driver = ProviderDriverKind.make("codex");

const layerPlatformTest = Layer.merge(
  NodeServices.layer,
  Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolveLink: () => Effect.die("unused title link"),
  }),
);
const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "skycot-model-fallback-engine-",
});
const orchestrationAdapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("sessions are not used here"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const providerInstance = {
  instanceId,
  driverKind: driver,
  continuationIdentity: { driverKind: driver, continuationKey: "codex:fallback-test" },
  displayName: "Codex test",
  enabled: true,
  snapshot: { getSnapshot: Effect.succeed({}) } as unknown as ProviderInstance["snapshot"],
  orchestrationAdapter,
  textGeneration: {} as ProviderInstance["textGeneration"],
} satisfies ProviderInstance;

const layerEngine = Layer.mergeAll(
  RuntimeLayer.layer,
  RuntimeLayer.layerEventSink,
  ProjectStore.layer,
  ProjectionStore.layer,
  EffectOutbox.layer,
  ThreadCommandExecutor.layer,
).pipe(
  Layer.provide(McpSessionRegistryTestkit.layer),
  Layer.provide(McpProviderSessions.layer),
  Layer.provide(SqlitePersistence.layerMemory),
  Layer.provide(
    CheckpointStore.layer.pipe(
      Layer.provide(
        VcsDriverRegistry.layer.pipe(
          Layer.provide(VcsProcess.layer),
          Layer.provide(layerServerConfig),
          Layer.provide(layerPlatformTest),
        ),
      ),
    ),
  ),
  Layer.provide(layerServerConfig),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (id) => Effect.succeed(id === instanceId ? providerInstance : undefined),
      listInstances: Effect.succeed([providerInstance]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(GitWorkflow.GitWorkflowService)({
      pruneWorktrees: () => Effect.void,
      createWorktree: () => Effect.succeed({} as never),
    }),
  ),
  Layer.provide(Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeedNone })),
  Layer.provide(layerPlatformTest),
);

it.layer(layerEngine)("SkycotModelFallback with the engine", (it) => {
  it.effect(
    "carries a limited turn on once, on the fallback model, and upstream waits no more",
    () =>
      Effect.gen(function* () {
        const engine = yield* Orchestrator.OrchestratorV2;
        const events = yield* EventSink.EventSinkV2;
        const projects = yield* ProjectStore.ProjectStoreV2;
        const threadId = ThreadId.make("fallback:thread");
        const projectId = ProjectId.make("fallback:project");
        const now = yield* DateTime.now;
        const createdAt = DateTime.formatIso(now);
        yield* projects.apply({
          sequence: 0,
          eventId: EventId.make("fallback:seed"),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.created",
          payload: {
            projectId,
            title: "Cat game",
            workspaceRoot: process.cwd(),
            defaultModelSelection: chosen,
            scripts: [],
            createdAt,
            updatedAt: createdAt,
          },
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("fallback:create"),
          threadId,
          projectId,
          title: "Cat game",
          modelSelection: chosen,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
        yield* engine.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("fallback:start"),
          threadId,
          messageId: MessageId.make("fallback:start"),
          text: "Make the cat jump.",
          attachments: [],
          dispatchMode: { type: "defer_start" },
          createdBy: "user",
          creationSource: "web",
        });
        const [source] = (yield* engine.getThreadProjection(threadId)).runs as [OrchestrationV2Run];
        // The provider says the turn hit its limit: the run fails with a usage-limit error.
        const resetAt = DateTime.formatIso(DateTime.add(now, { hours: 66 }));
        yield* events.write({
          events: [
            {
              id: EventId.make("fallback:failed"),
              type: "run.updated",
              threadId,
              occurredAt: now,
              payload: { ...source, status: "failed", completedAt: now },
            },
            {
              id: EventId.make("fallback:error"),
              type: "turn-item.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: TurnItemId.make("fallback:error"),
                type: "error",
                threadId,
                runId: source.id,
                nodeId: source.rootNodeId,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 2,
                status: "failed",
                title: "Usage limit reached",
                startedAt: now,
                completedAt: now,
                updatedAt: now,
                failure: {
                  class: "usage_limit",
                  message: "You've reached your GPT-6 Astra limit.",
                  code: "usageLimitExceeded",
                  retryable: null,
                  resetAt,
                },
              },
            },
          ],
        });
        // Upstream arms its wait-for-the-reset resume, as it does today.
        const shell = (yield* engine.getShellSnapshot()).threads.find(
          (thread) => thread.id === threadId,
        )!;
        yield* engine.dispatch(limitRecoveryCommand(shell, true, DateTime.toEpochMillis(now))!);
        const armed = (yield* engine.getShellSnapshot()).threads.find(
          (thread) => thread.id === threadId,
        )!;
        const scheduledResume = limitRecoveryCommand(armed, true, Date.parse(resetAt));
        assert.isNotNull(scheduledResume);

        const fallback = yield* makeFallback(engine, {
          // The model's own limit is spent; the provider's next model is fine.
          getProviders: Effect.succeed([
            provider({
              instanceId: "codex",
              driver: "codex",
              models: [
                {
                  slug: "gpt-6-astra",
                  name: "GPT-6 Astra",
                  isCustom: false,
                  capabilities: null,
                  isDefault: true,
                },
                { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", isCustom: false, capabilities: null },
              ],
              windows: [window("primary", "Session", 40, null)],
            }),
          ]),
          store: yield* makeMemorySwitchStore,
          turnRuleFor: () => Effect.succeed(() => true),
        });
        yield* fallback.carryOn(threadId, String(source.id));
        yield* fallback.carryOn(threadId, String(source.id));

        const after = yield* engine.getThreadProjection(threadId);
        assert.lengthOf(after.runs, 2);
        const continued = after.runs[1]!;
        assert.equal(continued.modelSelection.model, "gpt-6.1-sol");
        assert.equal(String(continued.userMessageId), `${SWITCH_MESSAGE_PREFIX}${source.id}`);
        assert.include(["starting", "running"], continued.status);
        // The conversation's model is the fallback while it runs; the person's choice is remembered.
        assert.equal(after.thread.modelSelection.model, "gpt-6.1-sol");

        // Upstream's resume after the reset no longer applies: the turn does not run twice.
        yield* engine.dispatch(scheduledResume!).pipe(Effect.ignore);
        assert.lengthOf((yield* engine.getThreadProjection(threadId)).runs, 2);
      }),
  );
});

/** Codex with its default model's own limit spent and its next model fine. */
const codexProviders = Effect.succeed([
  provider({
    instanceId: "codex",
    driver: "codex",
    models: [
      {
        slug: "gpt-6-astra",
        name: "GPT-6 Astra",
        isCustom: false,
        capabilities: null,
        isDefault: true,
      },
      { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", isCustom: false, capabilities: null },
    ],
    windows: [window("primary", "Session", 40, null)],
  }),
]);

const usageLimitFailure = (source: OrchestrationV2Run, now: DateTime.Utc, key: string) => {
  const threadId = source.threadId;
  return [
    {
      id: EventId.make(`${key}:failed`),
      type: "run.updated" as const,
      threadId,
      occurredAt: now,
      payload: { ...source, status: "failed" as const, completedAt: now },
    },
    {
      id: EventId.make(`${key}:error`),
      type: "turn-item.updated" as const,
      threadId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make(`${key}:error`),
        type: "error" as const,
        threadId,
        runId: source.id,
        nodeId: source.rootNodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 2,
        status: "failed" as const,
        title: "Usage limit reached",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        failure: {
          class: "usage_limit" as const,
          message: "You've reached your GPT-6 Astra limit.",
          code: "usageLimitExceeded",
          retryable: null,
          resetAt: DateTime.formatIso(DateTime.add(now, { hours: 66 })),
        },
      },
    },
  ];
};

it.layer(layerEngine.pipe(Layer.provideMerge(SkycotQueuedTurn.layer)))(
  "SkycotModelFallback with the engine's queue",
  (it) => {
    it.effect(
      "a message queued behind a limited turn starts on the fallback, with no failed attempt",
      () =>
        Effect.gen(function* () {
          const engine = yield* Orchestrator.OrchestratorV2;
          const events = yield* EventSink.EventSinkV2;
          const projects = yield* ProjectStore.ProjectStoreV2;
          const queuedTurn = yield* SkycotQueuedTurn.SkycotQueuedTurnModel;
          const threadId = ThreadId.make("fallback-queue:thread");
          const projectId = ProjectId.make("fallback-queue:project");
          const now = yield* DateTime.now;
          const createdAt = DateTime.formatIso(now);
          yield* projects.apply({
            sequence: 0,
            eventId: EventId.make("fallback-queue:seed"),
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: createdAt,
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            type: "project.created",
            payload: {
              projectId,
              title: "Dog game",
              workspaceRoot: process.cwd(),
              defaultModelSelection: chosen,
              scripts: [],
              createdAt,
              updatedAt: createdAt,
            },
          });
          const store = yield* makeMemorySwitchStore;
          const fallback = yield* makeFallback(engine, {
            getProviders: codexProviders,
            store,
            turnRuleFor: () => Effect.succeed(() => true),
          });
          yield* queuedTurn.register(fallback.queuedTurn);
          const send = fallback.service.dispatch;
          yield* send({
            type: "thread.create",
            commandId: CommandId.make("fallback-queue:create"),
            threadId,
            projectId,
            title: "Dog game",
            modelSelection: chosen,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdBy: "user",
            creationSource: "web",
          });
          yield* send({
            type: "message.dispatch",
            commandId: CommandId.make("fallback-queue:first"),
            threadId,
            messageId: MessageId.make("fallback-queue:first"),
            text: "Make the dog bark.",
            attachments: [],
            dispatchMode: { type: "defer_start" },
            createdBy: "user",
            creationSource: "web",
          });
          // The person sends the next message while the first turn still runs: it waits, stored
          // with the conversation's model (the one that is about to run out).
          yield* send({
            type: "message.dispatch",
            commandId: CommandId.make("fallback-queue:second"),
            threadId,
            messageId: MessageId.make("fallback-queue:second"),
            text: "And make it wag its tail.",
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          });
          const queued = yield* engine.getThreadProjection(threadId);
          const first = queued.runs.find(
            (candidate) => String(candidate.userMessageId) === "fallback-queue:first",
          )!;
          const waiting = queued.runs.find(
            (candidate) => String(candidate.userMessageId) === "fallback-queue:second",
          )!;
          assert.equal(waiting.status, "queued");
          assert.equal(waiting.modelSelection.model, "gpt-6-astra");

          // The first turn hits the model's limit. Upstream holds the queue behind it.
          yield* events.write({ events: usageLimitFailure(first, now, "fallback-queue") });
          yield* fallback.carryOn(threadId, String(first.id));
          const carried = yield* engine.getThreadProjection(threadId);
          const continuation = carried.runs.find(
            (candidate) =>
              String(candidate.userMessageId) === `${SWITCH_MESSAGE_PREFIX}${first.id}`,
          )!;
          assert.equal(continuation.modelSelection.model, "gpt-6.1-sol");
          assert.equal(
            carried.runs.find((candidate) => candidate.id === waiting.id)?.status,
            "queued",
          );

          // The carried-on turn finishes: the engine starts the waiting message, on the fallback.
          const fromSequence = yield* events.latestSequence();
          const finishedAt = yield* DateTime.now;
          yield* events.write({
            events: [
              {
                id: EventId.make("fallback-queue:continued"),
                type: "run.updated",
                threadId,
                occurredAt: finishedAt,
                payload: { ...continuation, status: "completed", completedAt: finishedAt },
              },
            ],
          });
          // The engine handles run updates on its own fiber: wait for the queued run to move.
          yield* events.stream({ afterSequence: fromSequence, eventType: "run.updated" }).pipe(
            Stream.filter(
              (stored) =>
                stored.event.type === "run.updated" &&
                stored.event.payload.id === waiting.id &&
                stored.event.payload.status !== "queued",
            ),
            Stream.take(1),
            Stream.runDrain,
          );
          const after = yield* engine.getThreadProjection(threadId);
          const started = after.runs.find((candidate) => candidate.id === waiting.id)!;
          assert.include(["starting", "running"], started.status);
          assert.equal(started.modelSelection.model, "gpt-6.1-sol");
          assert.equal(after.thread.modelSelection.model, "gpt-6.1-sol");
          // No run failed on the resting model but the first one, and nothing else was sent.
          assert.deepStrictEqual(
            after.runs.filter((candidate) => candidate.status === "failed").map((run) => run.id),
            [first.id],
          );
          assert.lengthOf(after.runs, 3);
          // The move was said once, when the first turn was carried on.
          assert.lengthOf(yield* store.switchesFor(String(threadId)), 1);
        }),
    );
  },
);
