import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  MessageId,
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
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import { shieldApprovalId } from "@t3tools/skycot-rules/personal";

import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyGate from "./SkycotFamilyGate.ts";
import * as SkycotFamilyInstructions from "./SkycotFamilyInstructions.ts";

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
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
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
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      return yield* use({ gate, family, limits });
    }).pipe(
      Effect.provide(
        SkycotFamilyGate.layerCore.pipe(
          Layer.provideMerge(
            SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
          ),
          Layer.provideMerge(Layer.merge(layerFamily, layerProjections)),
        ),
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

  it.effect("a parent's yes on the shield card sends that one message as typed, once", () =>
    withGate([], ({ gate, family, limits }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava" });
        const typed = "my name is Ava Smith and I go to St Kilda Primary";
        const send = (messageId: string) => ({
          sessionId: SESSION,
          method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
          payload: { type: "message.dispatch", threadId: THREAD_ID, messageId, text: typed },
        });
        const providerSees = (messageId: string) =>
          SkycotFamilyInstructions.withFamilyRules(Option.some(family), {
            messageId: MessageId.make(messageId),
            text: typed,
            attachments: [],
            createdBy: "user",
            creationSource: "web",
          }).pipe(Effect.map((message) => message.text));

        yield* family.verify({
          code: CODE,
          purpose: "approve",
          sessionId: SESSION,
          requestId: shieldApprovalId("message:allowed"),
        });
        yield* gate.check(send("message:allowed"));
        assert.include(yield* providerSees("message:allowed"), "Ava Smith");
        // The pass and the grant are both spent: the same id again is shielded.
        yield* gate.check(send("message:allowed"));
        assert.notInclude(yield* providerSees("message:allowed"), "Ava Smith");
        // The next message, with nobody's yes, is shielded as always.
        yield* gate.check(send("message:next"));
        assert.notInclude(yield* providerSees("message:next"), "St Kilda");
        // The recap hears what happened by kind of detail only.
        const events = (yield* limits.snapshot)?.activity.events ?? [];
        assert.deepEqual(
          events.map((event) => [event.kind, event.categories, event.threadId]),
          [
            ["shield-allowed", ["full-name", "school"], THREAD_ID],
            ["shield", ["full-name", "school"], THREAD_ID],
            ["shield", ["full-name", "school"], THREAD_ID],
          ],
        );
        assert.notInclude(JSON.stringify(events), "Smith");
      }),
    ),
  );

  it.effect("plan first: only Build it, or a grown-up in Advanced mode, runs without a plan", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava" });
        const dispatch = (sessionId: string, messageId: string, extra: object = {}) =>
          gate.check({
            sessionId,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: {
              type: "message.dispatch",
              threadId: THREAD_ID,
              messageId,
              text: "Build it",
              ...extra,
            },
          });
        const modeFor = (messageId: string) =>
          SkycotFamilyInstructions.familyTurnInput(family, {
            message: {
              messageId: MessageId.make(messageId),
              text: "Build it",
              attachments: [],
              createdBy: "user",
              creationSource: "web",
            },
            runtimePolicy: {
              runtimeMode: "approval-required",
              interactionMode: "default",
              cwd: null,
            },
          } as unknown as Parameters<typeof SkycotFamilyInstructions.familyTurnInput>[1]).pipe(
            Effect.map((input) => input.runtimePolicy.interactionMode),
          );

        assert.isTrue(
          SkycotFamilyGate.buildsPlan(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
            type: "message.dispatch",
            sourcePlanRef: { threadId: THREAD_ID, planId: "plan-1" },
          }),
        );
        yield* dispatch(SESSION, "message:build", {
          sourcePlanRef: { threadId: THREAD_ID, planId: "plan-1" },
        });
        assert.equal(yield* modeFor("message:build"), "default");
        yield* dispatch(SESSION, "message:ordinary");
        assert.equal(yield* modeFor("message:ordinary"), "plan");
        // A request that never went through the gate (another way in) plans too.
        assert.equal(yield* modeFor("message:unseen"), "plan");
        // A grown-up working in Advanced mode keeps the conversation's own mode.
        yield* family.verify({ code: CODE, purpose: "advanced", sessionId: "session-parent" });
        yield* dispatch("session-parent", "message:parent");
        assert.equal(yield* modeFor("message:parent"), "default");
      }),
    ),
  );

  it.effect("a shield yes for one message does not reach another session's message", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava" });
        yield* family.verify({
          code: CODE,
          purpose: "approve",
          sessionId: "session-2",
          requestId: shieldApprovalId("message:elsewhere"),
        });
        yield* gate.check({
          sessionId: SESSION,
          method: ORCHESTRATION_V2_WS_METHODS.launchThread,
          payload: {
            threadId: "thread:new",
            projectId: "project:family",
            initialMessage: { messageId: "message:elsewhere", text: "my name is Ava Smith" },
          },
        });
        const wrapped = yield* SkycotFamilyInstructions.withFamilyRules(Option.some(family), {
          messageId: MessageId.make("message:elsewhere"),
          text: "my name is Ava Smith",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
        });
        assert.notInclude(wrapped.text, "Ava Smith");
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

describe("turnStartFor and startedBy", () => {
  it("names the calls that start a turn", () => {
    const dispatch = ORCHESTRATION_V2_WS_METHODS.dispatchCommand;
    assert.deepEqual(
      SkycotFamilyGate.turnStartFor(dispatch, { type: "message.dispatch", threadId: "t1" }),
      { threadId: "t1", instanceId: undefined },
    );
    assert.isNotNull(
      SkycotFamilyGate.turnStartFor(dispatch, { type: "queue.resume", threadId: "t1" }),
    );
    assert.isNull(
      SkycotFamilyGate.turnStartFor(dispatch, { type: "run.interrupt", threadId: "t1" }),
    );
    assert.isNull(SkycotFamilyGate.turnStartFor(dispatch, respond("accept")));
    assert.deepEqual(
      SkycotFamilyGate.turnStartFor(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        threadId: "t2",
        modelSelection: { instanceId: "codex" },
        initialMessage: { text: "hi" },
      }),
      { threadId: "t2", instanceId: "codex" },
    );
    assert.isNull(
      SkycotFamilyGate.turnStartFor(ORCHESTRATION_V2_WS_METHODS.launchThread, { threadId: "t2" }),
    );
  });

  it("names the conversation or project a call starts", () => {
    assert.deepEqual(
      SkycotFamilyGate.startedBy(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        threadId: "t2",
        projectId: "p1",
      }),
      { threadId: "t2", projectId: "p1" },
    );
    assert.isNull(
      SkycotFamilyGate.startedBy(ORCHESTRATION_V2_WS_METHODS.launchThread, {
        threadId: "t2",
        reuseExistingThread: true,
      }),
    );
    assert.deepEqual(
      SkycotFamilyGate.startedBy("projects.mutate", { type: "project.create", projectId: "p9" }),
      { projectId: "p9" },
    );
  });
});

it.layer(NodeServices.layer)("SkycotFamilyGate limits", (it) => {
  const MELBOURNE = "Australia/Melbourne";
  const at = (iso: string) => TestClock.setTime(Date.parse(iso));
  const message = (threadId = THREAD_ID) => ({
    method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
    payload: { type: "message.dispatch", threadId, text: "make it blue" },
  });

  /** One child with a 19:30–07:00 bedtime and three messages a day, on Melbourne's clock. */
  const setUp = (family: SkycotFamily.SkycotFamily["Service"]) =>
    Effect.gen(function* () {
      const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
      const childId = status.children[0]!.id;
      yield* family.updateChild({
        childId,
        patch: { limits: { bedtime: { start: "19:30", end: "07:00" }, dailyTurns: 3 } },
      });
      return childId;
    });

  it.effect(
    "refuses a turn at bedtime with the asleep permission, and lets it through by day",
    () =>
      withGate([], ({ gate, family }) =>
        Effect.gen(function* () {
          yield* setUp(family);
          yield* at("2026-10-22T16:00:00+11:00");
          yield* gate.check({ sessionId: SESSION, ...message() });
          yield* at("2026-10-22T19:31:00+11:00");
          const error = yield* Effect.flip(gate.check({ sessionId: SESSION, ...message() }));
          assert.equal(error.requiredPermission, SkycotFamilyGate.FAMILY_ASLEEP_PERMISSION);
          assert.include(error.message, "bedtime");
          assert.include(error.message, "7:00 am");
          yield* at("2026-10-23T07:00:00+11:00");
          yield* gate.check({ sessionId: SESSION, ...message() });
        }),
      ),
  );

  it.effect("counts messages and stops at the day's cap until tomorrow", () =>
    withGate([], ({ gate, family, limits }) =>
      Effect.gen(function* () {
        yield* setUp(family);
        yield* at("2026-10-22T09:00:00+11:00");
        for (let index = 0; index < 3; index += 1) {
          yield* gate.check({ sessionId: SESSION, ...message() });
        }
        const error = yield* Effect.flip(gate.check({ sessionId: SESSION, ...message() }));
        assert.include(error.message, "today's 3 messages");
        const session = yield* limits.forSession({ sessionId: SESSION });
        assert.equal(session.limits?.turns, 3);
        assert.equal(session.limits?.reason, "turns");
        yield* at("2026-10-23T08:00:00+11:00");
        yield* gate.check({ sessionId: SESSION, ...message() });
      }),
    ),
  );

  it.effect(
    "finishes the current step, then pauses: a child's yes to the next step is refused",
    () =>
      withGate([approval("file-change", "Edit index.html")], ({ gate, family }) =>
        Effect.gen(function* () {
          yield* setUp(family);
          yield* at("2026-10-22T15:00:00+11:00");
          const respondCall = {
            sessionId: SESSION,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: respond("accept"),
          };
          yield* gate.check(respondCall);
          yield* at("2026-10-22T20:00:00+11:00");
          const error = yield* Effect.flip(gate.check(respondCall));
          assert.equal(error.requiredPermission, SkycotFamilyGate.FAMILY_ASLEEP_PERMISSION);
          // Saying no, or stopping, is always fine.
          yield* gate.check({ ...respondCall, payload: respond("decline") });
          yield* gate.check({
            ...respondCall,
            payload: { type: "run.interrupt", threadId: THREAD_ID, runId: "run-1" },
          });
        }),
      ),
  );

  it.effect("a grown-up's extra time lets turns through until it runs out", () =>
    withGate([], ({ gate, family, limits }) =>
      Effect.gen(function* () {
        const childId = yield* setUp(family);
        yield* at("2026-10-22T20:00:00+11:00");
        assert.isTrue(yield* refused(gate.check({ sessionId: SESSION, ...message() })));
        assert.equal(
          (yield* Effect.flip(
            limits.moreTime({
              sessionId: SESSION,
              childId,
              code: "000000",
              more: { type: "extra", minutes: 15 },
            }),
          )).reason,
          "wrong-code",
        );
        const after = yield* limits.moreTime({
          sessionId: SESSION,
          childId,
          code: CODE,
          more: { type: "extra", minutes: 15 },
        });
        assert.isFalse(after.limits?.asleep);
        assert.equal(after.limits?.minutesLeft, 15);
        yield* gate.check({ sessionId: SESSION, ...message() });
        yield* at("2026-10-22T20:16:00+11:00");
        assert.isTrue(yield* refused(gate.check({ sessionId: SESSION, ...message() })));
        const today = yield* limits.today;
        assert.deepEqual(
          today.children[0]!.moreTime.map((entry) => [entry.kind, entry.minutes, entry.reason]),
          [["extra", 15, "bedtime"]],
        );
      }),
    ),
  );

  it.effect("a parent in Advanced mode is not held to a child's bedtime", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* setUp(family);
        yield* at("2026-10-22T21:00:00+11:00");
        yield* family.verify({ code: CODE, purpose: "advanced", sessionId: SESSION });
        yield* gate.check({ sessionId: SESSION, ...message() });
      }),
    ),
  );

  it.effect(
    "with two children a device must choose first, and each child keeps their own day",
    () =>
      withGate([], ({ gate, family, limits }) =>
        Effect.gen(function* () {
          const ava = yield* setUp(family);
          const { childId: leo } = yield* family.addChild({ name: "Leo" });
          yield* at("2026-10-22T09:00:00+11:00");
          const error = yield* Effect.flip(gate.check({ sessionId: SESSION, ...message() }));
          assert.include(error.message, "Choose who's using SKYCOT");
          assert.isTrue((yield* limits.forSession({ sessionId: SESSION })).needsChoice);
          yield* limits.choose({ sessionId: SESSION, childId: ava, grownUp: false });
          for (let index = 0; index < 3; index += 1) {
            yield* gate.check({ sessionId: SESSION, ...message() });
          }
          assert.isTrue(yield* refused(gate.check({ sessionId: SESSION, ...message() })));
          // Ava is out of messages: switching to Leo needs a grown-up, not just a tap.
          const blocked = yield* Effect.flip(
            limits.choose({ sessionId: SESSION, childId: leo, grownUp: false }),
          );
          assert.equal(blocked._tag, "SkycotFamilyLimitRefusal");
          yield* limits.choose({ sessionId: SESSION, childId: leo, grownUp: true });
          yield* gate.check({ sessionId: SESSION, ...message() });
        }),
      ),
  );

  it.effect("remembers which child started a conversation; the first answer stands", () =>
    withGate([], ({ gate, family, limits }) =>
      Effect.gen(function* () {
        const ava = yield* setUp(family);
        const { childId: leo } = yield* family.addChild({ name: "Leo" });
        yield* at("2026-10-22T09:00:00+11:00");
        const launch = (threadId: string) => ({
          sessionId: SESSION,
          method: ORCHESTRATION_V2_WS_METHODS.launchThread,
          payload: { threadId, projectId: "project:family", initialMessage: { text: "hi" } },
        });
        yield* limits.choose({ sessionId: SESSION, childId: ava, grownUp: false });
        yield* gate.check(launch("thread:ava"));
        yield* limits.choose({ sessionId: SESSION, childId: leo, grownUp: false });
        yield* gate.check(launch("thread:leo"));
        const today = yield* limits.today;
        assert.deepEqual(today.threads, { "thread:ava": ava, "thread:leo": leo });
        assert.deepEqual(today.projects, { "project:family": ava });
      }),
    ),
  );
});
