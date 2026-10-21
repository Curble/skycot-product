import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  ORCHESTRATION_V2_WS_METHODS,
  RpcScopeAuthorization,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyGate from "./SkycotFamilyGate.ts";

const CODE = "482913";
const SESSION = "session-1";
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const NOW = DateTime.makeUnsafe("2026-10-22T09:00:00.000Z");
const THREAD_ID = ThreadId.make("thread:family");
const REQUEST_ID = RuntimeRequestId.make("req-1");
const ROOT = "/Users/kid/projects/space-game";

const thread: OrchestrationV2AppThread = {
  createdBy: "user",
  creationSource: "web",
  id: THREAD_ID,
  projectId: ProjectId.make("project:family"),
  title: "Space game",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: ROOT,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
  forkedFrom: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const common = {
  threadId: THREAD_ID,
  runId: null,
  nodeId: "node:approval" as never,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: { driver: CLAUDE, nativeId: "tool-1", strength: "strong" as const },
  parentItemId: null,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: NOW,
};

const approval = (
  requestKind: "command" | "file-change",
  prompt: string,
): OrchestrationV2TurnItem => ({
  ...common,
  id: TurnItemId.make("turn-item:runtime-request:req-1"),
  ordinal: 1,
  status: "waiting",
  type: "approval_request",
  requestId: REQUEST_ID,
  requestKind,
  prompt,
});

const commandCall = (input: string): OrchestrationV2TurnItem => ({
  ...common,
  id: TurnItemId.make("turn-item:provider:claudeAgent:native-item:tool-1"),
  ordinal: 0,
  status: "running",
  type: "command_execution",
  input,
});

const respond = (decision: "accept" | "acceptAlways" | "decline") => ({
  type: "runtime-request.respond",
  commandId: "cmd-1",
  threadId: THREAD_ID,
  requestId: REQUEST_ID,
  decision,
});

/** The gate over a real profile file and a projection that holds `items`. */
const withGate = <A, E, R>(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  use: (input: {
    readonly gate: SkycotFamilyGate.SkycotFamilyGate["Service"];
    readonly family: SkycotFamily.SkycotFamily["Service"];
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-gate-" });
    const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
    const layerProjections = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: () => Effect.succeed(thread),
        getTurnItem: ({ itemId }) =>
          Effect.succeed(items.find((item) => item.id === itemId) ?? null),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({ get: () => Effect.succeed(Option.none()) }),
    );
    return yield* Effect.gen(function* () {
      const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
      const family = yield* SkycotFamily.SkycotFamily;
      return yield* use({ gate, family });
    }).pipe(
      Effect.provide(
        SkycotFamilyGate.layer.pipe(Layer.provideMerge(Layer.merge(layerFamily, layerProjections))),
      ),
    );
  }).pipe(Effect.scoped);

const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(Effect.map((exit) => Exit.isFailure(exit)));

describe("gateNeedFor", () => {
  it("leaves ordinary work open", () => {
    for (const [method, payload] of [
      ["git.runStackedAction", { action: "commit" }],
      ["scheduledTasks.setEnabled", { enabled: false }],
      ["scheduledTasks.delete", {}],
      ["projects.mutate", { type: "project.update", title: "New name" }],
      ["server.updateSettings", { patch: { defaultRuntimeMode: "approval-required" } }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "message.dispatch" }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, respond("decline")],
      ["projects.writeFile", {}],
    ] as const) {
      assert.isNull(SkycotFamilyGate.gateNeedFor(method, payload), method);
    }
  });

  it("names the grown-up purpose for publishing, automations, folders and the developer tools", () => {
    const purpose = (method: string, payload: unknown = {}) => {
      const need = SkycotFamilyGate.gateNeedFor(method, payload);
      return need?.type === "grant" ? need.purpose : need?.type;
    };
    assert.equal(purpose("git.runStackedAction", { action: "commit_push_pr" }), "publish");
    assert.equal(purpose("pullRequests.runAction"), "publish");
    assert.equal(purpose("sourceControl.publishRepository"), "publish");
    assert.equal(purpose("scheduledTasks.upsert"), "automation");
    assert.equal(purpose("scheduledTasks.setEnabled", { enabled: true }), "automation");
    assert.equal(purpose("projects.mutate", { type: "project.create" }), "openFolder");
    assert.equal(purpose("projects.mutate", { type: "project.delete" }), "openFolder");
    assert.equal(purpose("terminal.open"), "advanced");
    assert.equal(purpose("provider.install.start"), "settings");
    assert.equal(
      purpose("server.updateSettings", { patch: { defaultRuntimeMode: "full-access" } }),
      "settings",
    );
    assert.equal(
      purpose("server.updateSettings", { patch: { providerInstances: {} } }),
      "settings",
    );
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, respond("accept")),
      "respond",
    );
  });
});

it.layer(NodeServices.layer)("SkycotFamilyGate.check", (it) => {
  it.effect("refuses publishing until a grown-up enters the code, for this session only", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        const publish = {
          sessionId: SESSION,
          method: "git.runStackedAction",
          payload: { action: "push" },
        };
        // Off: nothing is gated.
        assert.isFalse(yield* refused(gate.check(publish)));
        yield* family.enable({ code: CODE, childName: null });
        const error = yield* Effect.flip(gate.check(publish));
        assert.equal(error.requiredPermission, SkycotFamilyGate.FAMILY_PERMISSION);
        assert.equal(error.message, SkycotFamilyGate.FAMILY_REFUSAL_MESSAGE);
        yield* family.verify({ code: CODE, purpose: "publish", sessionId: SESSION });
        assert.isFalse(yield* refused(gate.check(publish)));
        assert.isTrue(yield* refused(gate.check({ ...publish, sessionId: "session-2" })));
      }),
    ),
  );

  it.effect("lets the child allow a routine edit inside the project", () =>
    withGate([approval("file-change", `Edit ${ROOT}/index.html`)], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        const call = {
          sessionId: SESSION,
          method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
          payload: respond("accept"),
        };
        assert.isFalse(yield* refused(gate.check(call)));
        assert.isFalse(
          yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
        );
        // "Always allow" widens what happens next, so it is a grown-up's call even here.
        assert.isTrue(yield* refused(gate.check({ ...call, payload: respond("acceptAlways") })));
      }),
    ),
  );

  it.effect("holds an internet step for the parent code, and spends the grant once", () =>
    withGate(
      [
        approval("command", "Download a sprite pack"),
        commandCall("curl -O https://sprites.test/pack.zip"),
      ],
      ({ gate, family }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          assert.isTrue(
            yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
          );
          const call = {
            sessionId: SESSION,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: respond("accept"),
          };
          assert.isTrue(yield* refused(gate.check(call)));
          // Declining never needs a grown-up.
          assert.isFalse(yield* refused(gate.check({ ...call, payload: respond("decline") })));
          yield* family.verify({
            code: CODE,
            purpose: "approve",
            sessionId: SESSION,
            requestId: REQUEST_ID,
          });
          assert.isFalse(yield* refused(gate.check(call)));
          assert.isTrue(yield* refused(gate.check(call)));
        }),
    ),
  );

  it.effect("holds a request it cannot read", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        assert.isTrue(
          yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
        );
      }),
    ),
  );

  it.effect("wraps the scope middleware: a refused call never reaches it", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        let scopeChecks = 0;
        const layerScope = Layer.succeed(RpcScopeAuthorization)((effect) => {
          scopeChecks += 1;
          return effect;
        });
        const call = (method: string) =>
          Effect.gen(function* () {
            const middleware = yield* RpcScopeAuthorization;
            return yield* Effect.exit(
              middleware(
                Effect.succeed("ran") as never,
                { rpc: { _tag: method }, payload: {} } as never,
              ),
            );
          }).pipe(
            Effect.provide(SkycotFamilyGate.layerRpcAuthorization(gate, SESSION)),
            Effect.provide(layerScope),
          );
        assert.isTrue(Exit.isFailure(yield* call("terminal.open")));
        assert.equal(scopeChecks, 0);
        assert.isTrue(Exit.isSuccess(yield* call("projects.readFile")));
        assert.equal(scopeChecks, 1);
      }),
    ),
  );
});
