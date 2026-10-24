// The fallback against the real engine (the same in-memory runtime upstream's runtimeLayer tests
// build): a turn a usage limit stopped is carried on once with the fallback model, through the
// engine's own manual-continuation path, and upstream's scheduled resume for the same run is then
// refused, so the turn never runs twice.
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
          moveRuleFor: () => Effect.succeed(() => true),
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
