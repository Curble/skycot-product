import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
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
  threadWorktreePath: string | null = ROOT,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-gate-" });
    const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
    const layerProjections = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: () => Effect.succeed({ ...thread, worktreePath: threadWorktreePath }),
        getTurnItem: ({ itemId }) =>
          Effect.succeed(items.find((item) => item.id === itemId) ?? null),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (projectId) =>
          Effect.succeed(
            projectId === thread.projectId
              ? Option.some({ id: projectId, workspaceRoot: ROOT } as never)
              : Option.none(),
          ),
        findActiveByWorkspaceRoot: (root) =>
          Effect.succeed(
            root === ROOT ? Option.some({ workspaceRoot: ROOT } as never) : Option.none(),
          ),
      }),
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
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.create", worktreePath: null }],
      [ORCHESTRATION_V2_WS_METHODS.launchThread, { workspaceStrategy: { type: "root" } }],
      ["secrets.answerRequest", { answer: { type: "decline" } }],
      ["preview.open", { threadId: "t" }],
      ["preview.navigate", { url: "http://localhost:5173/" }],
      ["preview.navigate", { url: "http://127.0.0.1:8765/index.html" }],
      ["provider.auth.cancel", {}],
      ["provider.install.cancel", {}],
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

  // QA FK-03: signing the parent out of an assistant, or into another account, skipped the code.
  it("needs the parent code for every assistant account, sign-in and settings change", () => {
    for (const method of [
      WS_METHODS.providerAuthStart,
      WS_METHODS.providerAuthComplete,
      WS_METHODS.providerAuthRespond,
      WS_METHODS.providerAuthLogout,
      WS_METHODS.chatGptReconnectProfile,
      WS_METHODS.chatGptImportProfile,
      WS_METHODS.providerConsumeResetCredit,
      WS_METHODS.providerUploadFeedback,
      WS_METHODS.serverUpsertKeybinding,
      WS_METHODS.serverRemoveKeybinding,
    ]) {
      assert.deepEqual(
        SkycotFamilyGate.gateNeedFor(method, {}),
        { type: "grant", purpose: "settings" },
        method,
      );
    }
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor(WS_METHODS.secretsAnswerRequest, {
        answer: { type: "save", secret: "sk-live" },
      }),
      { type: "grant", purpose: "settings" },
    );
  });

  it("treats other folders, outside agents, devices and the internet as a grown-up's", () => {
    const purpose = (method: string, payload: unknown = {}) => {
      const need = SkycotFamilyGate.gateNeedFor(method, payload);
      return need?.type === "grant" ? need.purpose : need?.type;
    };
    for (const method of [
      "sourceControl.cloneRepository",
      "projectClone.start",
      "projectClone.retry",
      "vcs.createWorktree",
      "vcs.removeWorktree",
    ]) {
      assert.equal(purpose(method), "openFolder", method);
    }
    for (const method of [
      "server.importAcpRegistrySession",
      "server.deleteAcpRegistrySession",
      "server.disableAcpRegistryProvider",
      "server.logoutAcpRegistry",
      "server.runStorageCleanup",
      "device.open",
      "device.action",
      "mcpApps.callTool",
      "vcs.pull",
      "git.preparePullRequestThread",
    ]) {
      assert.equal(purpose(method), "advanced", method);
    }
    assert.equal(purpose("preview.navigate", { url: "https://example.com/" }), "advanced");
    assert.equal(purpose("preview.open", { url: "https://youtube.com/" }), "advanced");
    assert.equal(purpose("projects.writeFile", { cwd: "/tmp" }), "projectFolder");
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
        type: "thread.create",
        worktreePath: "/Users/parent",
      }),
      "projectFolder",
    );
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/Users/parent" },
      }),
      "projectFolder",
    );
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        projectId: "project:family",
        workspaceStrategy: { type: "worktree", baseRef: "main" },
      }),
      "projectWorktree",
    );
    // Fetching the branch from the internet first is a remote operation.
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        projectId: "project:family",
        workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
      }),
      "openFolder",
    );
  });

  // Every RPC is a decision. A method upstream adds lands here until someone makes one, and
  // docs/nondev/FAMILY.md lists the same table.
  it("has made a decision for every WebSocket method", () => {
    const OPEN = new Set<string>([
      ...Object.values(ORCHESTRATION_V2_WS_METHODS).filter(
        (method) =>
          method !== ORCHESTRATION_V2_WS_METHODS.dispatchCommand &&
          method !== ORCHESTRATION_V2_WS_METHODS.launchThread,
      ),
      // Reading and watching.
      "projects.list",
      "filesystem.browse",
      "agentSessions.scan",
      "mcpApps.toolInfo",
      "mcpApps.readResource",
      "device.easAccount",
      "server.probe",
      "server.discoverSourceControl",
      "scheduledTasks.list",
      "scheduledTasks.subscribe",
      "pullRequests.list",
      "pullRequests.listStats",
      "pullRequests.summary",
      "pullRequests.routing",
      "pullRequests.routingIdentity",
      "pullRequests.stack",
      "pullRequests.linkedThreads",
      "pullRequests.detail",
      "pullRequests.preview",
      "pullRequests.checks",
      "pullRequests.activity",
      "pullRequests.reviewGuide",
      "pullRequests.threadComments",
      "pullRequests.diffFileContents",
      "pullRequests.filesViewed",
      "pullRequests.changeBreakdown",
      "pullRequests.subscribeRefreshes",
      "pullRequests.reviewerCandidates",
      "pullRequests.labelCandidates",
      "sourceControl.lookupRepository",
      "subscribeProjectClones",
      "subscribeVcsStatus",
      "subscribeWorktreeSetup",
      "subscribeTerminalEvents",
      "subscribeTerminalMetadata",
      "subscribePreviewEvents",
      "subscribeDiscoveredLocalServers",
      "subscribeDeviceState",
      "subscribeServerConfig",
      "subscribeServerLifecycle",
      "subscribeAuthAccess",
      "subscribeBackgroundPolicy",
      "subscribeResourceTelemetry",
      "projects.listEntries",
      "projects.listIgnoredFiles",
      "projects.readFile",
      "projects.searchContents",
      "projects.searchEntries",
      "projects.createNew",
      "projects.ensureScratch",
      "filesystem.getMetadata",
      "assets.createUrl",
      "assets.persistChatAttachments",
      "attachments.createUploadUrl",
      "attachments.delete",
      "mcpApps.updateModelContext",
      "provider.install.cancel",
      "provider.install.subscribe",
      "provider.auth.cancel",
      "provider.auth.subscribe",
      "provider.chatgpt.handoff.subscribe",
      "provider.codex.auth-callback.subscribe",
      "vcs.refreshStatus",
      "vcs.listRefs",
      "vcs.createRef",
      "vcs.switchRef",
      "vcs.init",
      "review.getDiffPreview",
      "review.getDiffFileContents",
      "terminal.observe",
      "terminal.resize",
      "terminal.clear",
      "terminal.close",
      "preview.adjust",
      "preview.refresh",
      "preview.close",
      "preview.list",
      "preview.clearProfile",
      "preview.reportProfiles",
      "preview.reportStatus",
      "preview.resize",
      "device.list",
      "device.detail",
      "server.getConfig",
      "server.refreshProviders",
      "server.getStorageCleanupReport",
      "server.getDatabaseStorage",
      "server.getSettings",
      "server.searchAcpRegistry",
      "server.listAcpRegistrySessions",
      "server.listAcpRegistryProviders",
      "server.getTraceDiagnostics",
      "server.getProcessDiagnostics",
      "server.getHostResources",
      "server.getProcessResourceHistory",
      "server.getResourceTelemetryHistory",
      "server.retryResourceTelemetry",
      "server.reportClientActivity",
      "server.reportHostPowerState",
      "server.getBackgroundPolicy",
      "server.getUsageSummary",
      "server.refreshUsageRates",
      "scheduledTasks.delete",
      "scheduledTasks.listWebhookDeliveries",
      "scheduledTasks.getWebhookDelivery",
      "cloud.getRelayClientStatus",
      "pullRequests.setFilesViewed",
      "pullRequests.generateReviewGuide",
      "pullRequests.invalidate",
      "pullRequests.reportState",
      "projectClone.cancel",
      "worktreeSetup.cancel",
    ]);
    /** Open or not by what the call carries (tested above). */
    const BY_PAYLOAD = new Set<string>([
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      ORCHESTRATION_V2_WS_METHODS.launchThread,
      "git.runStackedAction",
      "scheduledTasks.setEnabled",
      "projects.mutate",
      "projects.writeFile",
      "server.updateSettings",
      "secrets.answerRequest",
      "preview.open",
      "preview.navigate",
    ]);
    const undecided = [
      ...Object.values(WS_METHODS),
      ...Object.values(ORCHESTRATION_V2_WS_METHODS),
    ].filter(
      (method) =>
        !OPEN.has(method) &&
        !BY_PAYLOAD.has(method) &&
        SkycotFamilyGate.gateNeedFor(method, {}) === null,
    );
    assert.deepEqual(undecided, []);
  });
});

describe("gateNeedForHttp", () => {
  it("holds the HTTP routes that change folders, pairing, connections and outside agents", () => {
    const need = (pathname: string, body: unknown = {}, method = "POST") =>
      SkycotFamilyGate.gateNeedForHttp(method, pathname, body);
    assert.deepEqual(need("/api/projects/mutate", { type: "project.create" }), {
      type: "grant",
      purpose: "openFolder",
    });
    assert.isNull(need("/api/projects/mutate", { type: "project.update", title: "Rocket" }));
    for (const pathname of [
      "/api/auth/pairing-token",
      "/api/connect/link-proof",
      "/api/connect/relay-config",
      "/api/connect/unlink",
      "/api/connect/preferences",
      "/api/connect/mint-credential",
      "/api/t3-connect/mint-credential",
    ]) {
      assert.deepEqual(need(pathname), { type: "grant", purpose: "advanced" }, pathname);
    }
    assert.deepEqual(need("/oauth/mcp/decision", { decision: { _tag: "approve" } }), {
      type: "grant",
      purpose: "advanced",
    });
    // Saying no, signing devices out and signing in are never held.
    assert.isNull(need("/oauth/mcp/decision", { decision: { _tag: "deny" } }));
    for (const pathname of [
      "/api/auth/clients/revoke",
      "/api/auth/clients/revoke-others",
      "/api/auth/pairing-links/revoke",
      "/api/auth/browser-session",
      "/api/auth/websocket-ticket",
      "/oauth/token",
      "/api/skycot/family/verify",
    ]) {
      assert.isNull(need(pathname), pathname);
    }
    assert.isNull(need("/api/projects/mutate", { type: "project.create" }, "GET"));
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

  it.effect("lets the child allow an edit in the conversation's private copy", () => {
    const copy = "/Users/kid/.t3/worktrees/Space game copy/skycot-rockets-1a2b";
    return withGate(
      [approval("file-change", `add ${copy}/rockets.html`)],
      ({ gate, family }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          assert.isFalse(
            yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
          );
        }),
      copy,
    );
  });

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

  it.effect("lets the child write inside a project SKYCOT has, and nowhere else", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        const write = (cwd: string) =>
          gate.check({
            sessionId: SESSION,
            method: "projects.writeFile",
            payload: { cwd, relativePath: "index.html", contents: "" },
          });
        assert.isFalse(yield* refused(write(ROOT)));
        assert.isFalse(yield* refused(write(`${ROOT}/`)));
        assert.isTrue(yield* refused(write("/Users/kid")));
        const http = (pathname: string, payload: unknown) =>
          gate.checkHttp({ sessionId: SESSION, method: "POST", pathname, payload });
        assert.isTrue(yield* refused(http("/api/auth/pairing-token", {})));
        assert.isTrue(yield* refused(http("/api/projects/mutate", { type: "project.create" })));
        assert.isFalse(yield* refused(http("/api/auth/clients/revoke", {})));
        yield* family.verify({ code: CODE, purpose: "openFolder", sessionId: SESSION });
        assert.isFalse(yield* refused(write("/Users/kid")));
        assert.isFalse(yield* refused(http("/api/projects/mutate", { type: "project.create" })));
        assert.isTrue(yield* refused(http("/api/auth/pairing-token", {})));
      }),
    ),
  );

  // A conversation's private copy is what makes Undo work, so the child gets one in a
  // project SKYCOT has. A worktree anywhere else, or removing one, is still a grown-up's.
  it.effect("lets a new conversation make its private copy, and nothing more", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        const launch = (projectId: string, workspaceStrategy: unknown) =>
          gate.check({
            sessionId: SESSION,
            method: ORCHESTRATION_V2_WS_METHODS.launchThread,
            payload: { projectId, threadId: THREAD_ID, workspaceStrategy },
          });
        const privateCopy = { type: "worktree", baseRef: "main", branch: "skycot/space-1a2b" };
        assert.isFalse(yield* refused(launch(thread.projectId, privateCopy)));
        assert.isTrue(yield* refused(launch("project:unknown", privateCopy)));
        assert.isTrue(
          yield* refused(launch(thread.projectId, { ...privateCopy, startFromOrigin: true })),
        );
        const vcs = (method: string, payload: unknown) =>
          gate.check({ sessionId: SESSION, method, payload });
        assert.isTrue(
          yield* refused(
            vcs("vcs.createWorktree", {
              cwd: ROOT,
              refName: "main",
              newRefName: "skycot/elsewhere",
              path: "/Users/kid/Desktop/elsewhere",
            }),
          ),
        );
        assert.isTrue(yield* refused(vcs("vcs.removeWorktree", { cwd: ROOT, path: ROOT })));
        assert.isTrue(yield* refused(vcs("vcs.pull", { cwd: ROOT })));
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
            Effect.provide(
              SkycotFamilyGate.layerRpcAuthorization(gate, SESSION).pipe(Layer.provide(layerScope)),
            ),
          );
        assert.isTrue(Exit.isFailure(yield* call("terminal.open")));
        assert.equal(scopeChecks, 0);
        assert.isTrue(Exit.isSuccess(yield* call("projects.readFile")));
        assert.equal(scopeChecks, 1);
      }),
    ),
  );
});
