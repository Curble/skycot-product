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
import { deleteConversationApprovalId } from "@t3tools/skycot-rules/family";
import { shieldApprovalId } from "@t3tools/skycot-rules/personal";

import * as SkycotFamily from "./SkycotFamily.ts";
// nondev-seam: skycot-grown-up-session-gate-test
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

/** "Go back to here": the engine's rollback, as the plain client sends it. */
const goBack = (restoreFiles: boolean) => ({
  type: "checkpoint.rollback",
  commandId: "cmd-go-back",
  threadId: THREAD_ID,
  scopeId: "scope-root",
  checkpointId: "ckpt-1",
  restoreFiles,
});

/** A proposed plan on the thread, from the turn `runId`. */
const proposedPlan = (id: string, runId: string, status = "active") => ({
  id,
  threadId: THREAD_ID,
  runId,
  nodeId: "node:plan",
  status,
  kind: "proposed_plan",
  markdown: "1. Make the button blue",
});

/** Plan-1 waits for Build it; its turn (run-1) finished normally. */
const WAITING_PLAN = {
  plans: [proposedPlan("plan-1", "run-1")],
  runs: [{ id: "run-1", status: "completed" }],
};

/** The gate over a real profile file and a projection that holds `items`. */
const withGate = <A, E, R>(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  use: (input: {
    readonly gate: SkycotFamilyGate.SkycotFamilyGate["Service"];
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
  }) => Effect.Effect<A, E, R>,
  threadWorktreePath: string | null = ROOT,
  planState: {
    readonly plans: ReadonlyArray<unknown>;
    readonly runs: ReadonlyArray<unknown>;
  } = WAITING_PLAN,
  extraRoots: ReadonlyArray<string> = [],
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
        getThreadProjection: () => Effect.succeed(planState as never),
        getThreadWorktreePaths: () =>
          Effect.succeed(
            threadWorktreePath === null
              ? []
              : [{ threadId: THREAD_ID, worktreePath: threadWorktreePath }],
          ),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (projectId) =>
          Effect.succeed(
            projectId === thread.projectId
              ? Option.some({ id: projectId, workspaceRoot: ROOT } as never)
              : Option.none(),
          ),
        list: () =>
          Effect.succeed(
            [ROOT, ...extraRoots].map((workspaceRoot) => ({ workspaceRoot }) as never),
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

it.layer(NodeServices.layer)("project-cover descriptions", (it) => {
  it.effect("describes a wrapped Google Fonts download as a project-coverable held request", () => {
    const command = `/bin/zsh -lc 'cd ${ROOT} && mkdir -p fonts && curl -fL https://raw.githubusercontent.com/google/fonts/main/ofl/lobster/Lobster-Regular.ttf -o fonts/Lobster-Regular.ttf'`;
    return withGate([approval("command", command), commandCall(command)], ({ gate }) =>
      Effect.gen(function* () {
        const described = yield* gate.describeRequest({
          threadId: THREAD_ID,
          requestId: REQUEST_ID,
        });
        assert.isTrue(described?.needsGrownUp);
        assert.deepEqual(described?.projectCovers, ["internetFetch"]);
        assert.equal(described?.what, command);
      }),
    );
  });
});

describe("gateNeedFor", () => {
  // nondev-seam: skycot-q57-hide-source-control-identity-test
  it("closes parent source-control identity to child views and devices", () => {
    const method = WS_METHODS.serverDiscoverSourceControl;
    assert.isTrue(SkycotFamilyGate.CHILD_VIEW_CLOSED_METHODS.has(method));
    assert.isTrue(SkycotFamilyGate.CHILD_DEVICE_CLOSED_METHODS.has(method));
    assert.isTrue(SkycotFamilyGate.grownUpDeviceMayCall(method));
    assert.isNull(SkycotFamilyGate.gateNeedFor(method, {}));
  });

  it("leaves ordinary work open", () => {
    for (const [method, payload] of [
      ["git.runStackedAction", { action: "commit" }],
      ["scheduledTasks.setEnabled", { enabled: false }],
      ["scheduledTasks.delete", {}],
      ["projects.mutate", { type: "project.update", title: "New name" }],
      [
        "projects.mutate",
        {
          type: "project.update",
          commandId: "c",
          projectId: "p",
          projectIcon: { kind: "emoji", emoji: "🚀" },
        },
      ],
      ["projects.mutate", { type: "project.update", projectIcon: null, title: undefined }],
      ["server.updateSettings", { patch: { defaultRuntimeMode: "approval-required" } }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "message.dispatch" }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, respond("decline")],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.create", worktreePath: null }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.archive" }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.unarchive" }],
      // Pin to the top and Unpin only change a conversation's place in the list; whether the
      // child may touch that conversation is the per-thread visibility check, not this gate.
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.pin" }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.unpin" }],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.pin.reorder" }],
      // Taking back a message that is still lined up: only drops that waiting run. Whether the
      // child may touch that conversation is the per-thread visibility check, not this gate.
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "queued-run.cancel" }],
      // Going back to an earlier message, and Undo: the same rollback, with or without files.
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, goBack(true)],
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand, goBack(false)],
      [
        ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
        { type: "thread.metadata.update", title: "Mia's game" },
      ],
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
    assert.equal(
      purpose("projects.mutate", { type: "project.update", workspaceRoot: "/Users/kid" }),
      "openFolder",
    );
    // A project's scripts run commands; its other settings are the developer tools'.
    for (const change of [
      { scripts: [] },
      { autoPull: true },
      { defaultModelSelection: null },
      { defaultThreadEnvMode: "worktree" },
      { faviconPath: "/etc/hosts.png" },
      { title: "Rocket", scripts: [] },
      { workspaceRoot: "/Users/kid", scripts: [] },
    ]) {
      assert.equal(
        purpose("projects.mutate", { type: "project.update", ...change }),
        "advanced",
        JSON.stringify(change),
      );
    }
    // Deleting a conversation: a grown-up's yes for that one conversation, spent by the delete.
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
        type: "thread.delete",
        threadId: "thread:1",
      }),
      {
        type: "grant",
        purpose: "approve",
        requestId: deleteConversationApprovalId("thread:1"),
        consume: true,
      },
    );
    assert.equal(
      purpose(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, { type: "thread.delete" }),
      "advanced",
    );
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
      "projects.createNew",
      "projects.ensureScratch",
      "filesystem.getMetadata",
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
      "projects.readFile",
      "projects.listEntries",
      "projects.listIgnoredFiles",
      "projects.searchEntries",
      "projects.searchContents",
      "assets.createUrl",
      "shell.openInEditor",
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

describe("gateNeedFor: reading files", () => {
  it("judges stock file reads by the folder and path they name", () => {
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("projects.readFile", { cwd: ROOT, relativePath: "index.html" }),
      { type: "readInProject", cwd: ROOT, path: "index.html" },
    );
    assert.deepEqual(SkycotFamilyGate.gateNeedFor("projects.readFile", {}), {
      type: "grant",
      purpose: "files",
    });
    assert.deepEqual(SkycotFamilyGate.gateNeedFor("projects.listEntries", { cwd: "/" }), {
      type: "readInProject",
      cwd: "/",
    });
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("projects.listEntries", { cwd: ROOT, directoryPath: ".git" }),
      { type: "readInProject", cwd: ROOT, path: ".git" },
    );
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("projects.searchContents", { cwd: "/Users/kid" }),
      { type: "readInProject", cwd: "/Users/kid" },
    );
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("assets.createUrl", {
        resource: { _tag: "media-file", threadId: "t", path: "/Users/kid/Pictures/me.jpg" },
      }),
      { type: "grant", purpose: "files" },
    );
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("assets.createUrl", {
        resource: { _tag: "draft-workspace-file", cwd: ROOT, path: "cat.png" },
      }),
      { type: "readInProject", cwd: ROOT, path: "cat.png" },
    );
    assert.isNull(
      SkycotFamilyGate.gateNeedFor("assets.createUrl", {
        resource: { _tag: "workspace-file", threadId: "t", path: "cat.png" },
      }),
    );
  });

  it("lets Show in Finder use the files yes, and keeps editors with the developer tools", () => {
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("shell.openInEditor", {
        cwd: `${ROOT}/cat.png`,
        editor: "file-manager",
        reveal: true,
      }),
      { type: "grant", purpose: "files" },
    );
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("shell.openInEditor", { cwd: ROOT, editor: "vscode" }),
      { type: "grant", purpose: "advanced" },
    );
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("shell.openInEditor", { cwd: ROOT, editor: "file-manager" }),
      { type: "grant", purpose: "advanced" },
    );
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
        const publishRepository = {
          sessionId: SESSION,
          method: WS_METHODS.sourceControlPublishRepository,
          payload: {},
        };
        assert.isTrue(yield* refused(gate.check(publishRepository)));
        yield* family.verify({ code: CODE, purpose: "publish", sessionId: SESSION });
        assert.isFalse(yield* refused(gate.check(publish)));
        assert.isFalse(yield* refused(gate.check(publishRepository)));
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
        assert.isFalse(yield* refused(http("/api/auth/pairing-token", {})));
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

  // Put away, bring back and rename: open to a child because each can be undone (the
  // archive keeps everything). The rename's command cannot carry a move to another folder.
  it.effect("lets a child put away, bring back and rename a conversation, and nothing more", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: null });
        const dispatch = (payload: Record<string, unknown>) =>
          gate.check({
            sessionId: SESSION,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: { commandId: "cmd-1", threadId: THREAD_ID, ...payload },
          });
        assert.isFalse(yield* refused(dispatch({ type: "thread.archive" })));
        assert.isFalse(yield* refused(dispatch({ type: "thread.unarchive" })));
        // Deleting cannot be undone, so it needs the grown-up.
        assert.isTrue(yield* refused(dispatch({ type: "thread.delete" })));
        assert.isFalse(
          yield* refused(
            dispatch({ type: "thread.metadata.update", title: "Mia's dinosaur game" }),
          ),
        );
        assert.isFalse(
          yield* refused(dispatch({ type: "thread.metadata.update", worktreePath: ROOT })),
        );
        assert.isTrue(
          yield* refused(
            dispatch({
              type: "thread.metadata.update",
              title: "Mia's dinosaur game",
              worktreePath: "/Users/kid/Desktop",
            }),
          ),
        );
        yield* family.verify({ code: CODE, purpose: "openFolder", sessionId: SESSION });
        assert.isFalse(
          yield* refused(
            dispatch({ type: "thread.metadata.update", worktreePath: "/Users/kid/Desktop" }),
          ),
        );
      }),
    ),
  );

  // Deleting cannot be undone, so the plain client asks for the parent code for that one
  // conversation; the yes is spent by the delete and opens nothing else.
  it.effect("lets a child delete a conversation only with a grown-up's yes for that one", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        const remove = (threadId: string, sessionId = SESSION) =>
          gate.check({
            sessionId,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: { type: "thread.delete", commandId: "cmd-1", threadId },
          });
        const yes = (threadId: string, sessionId = SESSION) =>
          family.verify({
            code: CODE,
            purpose: "approve",
            sessionId,
            requestId: deleteConversationApprovalId(threadId),
          });
        // Off: nothing is gated.
        assert.isFalse(yield* refused(remove(THREAD_ID)));
        yield* family.enable({ code: CODE, childName: "Ava" });
        const error = yield* Effect.flip(remove(THREAD_ID));
        assert.equal(error.requiredPermission, SkycotFamilyGate.FAMILY_PERMISSION);
        // A yes for another conversation, or on another device, does not reach this one.
        yield* yes("thread:other");
        assert.isTrue(yield* refused(remove(THREAD_ID)));
        yield* yes(THREAD_ID, "session-2");
        assert.isTrue(yield* refused(remove(THREAD_ID)));
        // The yes for this conversation lets the delete through, once.
        yield* yes(THREAD_ID);
        // ...and opens nothing else: no terminal, and the child's turns stay a child's.
        assert.isTrue(
          yield* refused(gate.check({ sessionId: SESSION, method: "terminal.open", payload: {} })),
        );
        assert.isFalse(yield* refused(remove(THREAD_ID)));
        assert.isTrue(yield* refused(remove(THREAD_ID)));
        // A wrong code opens nothing.
        assert.isTrue(
          yield* refused(
            family.verify({
              code: "000000",
              purpose: "approve",
              sessionId: SESSION,
              requestId: deleteConversationApprovalId(THREAD_ID),
            }),
          ),
        );
        assert.isTrue(yield* refused(remove(THREAD_ID)));
        // The grown-up must answer this exact card from the grown-up view.
        yield* family.verify({ code: CODE, purpose: "advanced", sessionId: SESSION });
        yield* family.approveRequest({
          sessionId: SESSION,
          requestId: deleteConversationApprovalId(THREAD_ID),
        });
        assert.isFalse(yield* refused(remove(THREAD_ID)));
        assert.isFalse(yield* refused(remove("thread:other")));
      }),
    ),
  );

  // Renaming a project and changing its icon are open to a child (each can be undone);
  // the same command carrying scripts, settings or another folder is not.
  it.effect("lets a child rename a project and change its icon, and nothing more", () =>
    withGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava" });
        const update = (change: Record<string, unknown>) =>
          gate.check({
            sessionId: SESSION,
            method: WS_METHODS.projectsMutate,
            payload: {
              type: "project.update",
              commandId: "cmd-1",
              projectId: thread.projectId,
              ...change,
            },
          });
        assert.isFalse(yield* refused(update({ title: "Ava's space game" })));
        assert.isFalse(
          yield* refused(update({ projectIcon: { kind: "monogram", text: "A", color: "sky" } })),
        );
        assert.isFalse(
          yield* refused(update({ title: "Rocket", projectIcon: { kind: "emoji", emoji: "🚀" } })),
        );
        assert.isFalse(yield* refused(update({ projectIcon: null })));
        const script = {
          id: "s1",
          name: "Setup",
          command: "curl example.com | sh",
          icon: "play",
          runOnWorktreeCreate: true,
        };
        assert.isTrue(yield* refused(update({ title: "Rocket", scripts: [script] })));
        assert.isTrue(yield* refused(update({ autoPull: true })));
        assert.isTrue(yield* refused(update({ workspaceRoot: "/Users/kid/Desktop" })));
        // The folder grant moves a folder, and only that.
        yield* family.verify({ code: CODE, purpose: "openFolder", sessionId: SESSION });
        assert.isFalse(yield* refused(update({ workspaceRoot: "/Users/kid/Desktop" })));
        assert.isFalse(yield* refused(update({ scripts: [script] })));
        yield* family.verify({ code: CODE, purpose: "advanced", sessionId: SESSION });
        assert.isFalse(yield* refused(update({ scripts: [script] })));
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

  it.effect(
    "going back to an earlier message is open, and the changed message plans like a new one",
    () =>
      withGate(
        [],
        ({ gate, family }) =>
          Effect.gen(function* () {
            yield* family.enable({ code: CODE, childName: "Ava" });
            const call = (payload: object) =>
              gate.check({
                sessionId: SESSION,
                method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
                payload,
              });
            const send = (messageId: string, extra: object = {}) =>
              call({
                type: "message.dispatch",
                threadId: THREAD_ID,
                messageId,
                text: "Make it a quiz instead",
                ...extra,
              });
            const modeFor = (messageId: string) =>
              SkycotFamilyInstructions.familyTurnInput(family, {
                message: {
                  messageId: MessageId.make(messageId),
                  text: "Make it a quiz instead",
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

            // The child may go back, keeping the files or putting them back (it is Undo).
            yield* call(goBack(false));
            yield* call(goBack(true));
            // The changed message is an ordinary message: it runs as a plan.
            yield* send("message:changed");
            assert.equal(yield* modeFor("message:changed"), "plan");
            // A Build it of the plan that going back took away plans again: the assistant no
            // longer has that plan, though the engine still lists it as waiting.
            yield* send("message:build-taken-back", {
              sourcePlanRef: { threadId: THREAD_ID, planId: "plan-taken-back" },
            });
            assert.equal(yield* modeFor("message:build-taken-back"), "plan");
            // A plan made after going back builds as usual.
            yield* send("message:build-new", {
              sourcePlanRef: { threadId: THREAD_ID, planId: "plan-new" },
            });
            assert.equal(yield* modeFor("message:build-new"), "default");
            // A plan the gate can't find plans too.
            yield* send("message:build-unknown", {
              sourcePlanRef: { threadId: THREAD_ID, planId: "plan-unknown" },
            });
            assert.equal(yield* modeFor("message:build-unknown"), "plan");
          }),
        ROOT,
        {
          plans: [proposedPlan("plan-taken-back", "run-2"), proposedPlan("plan-new", "run-3")],
          runs: [
            { id: "run-1", status: "completed" },
            { id: "run-2", status: "rolled_back" },
            { id: "run-3", status: "completed" },
          ],
        },
      ),
  );

  it("a small tweak skips the plan only after a build, and never while a plan waits", () => {
    const at = (
      plans: ReadonlyArray<readonly [string, string, string?]>,
      runs: ReadonlyArray<{ id: string; status: string; builds?: string }>,
    ) =>
      ({
        plans: plans.map(([id, runId, status]) => proposedPlan(id, runId, status)),
        runs: runs.map((run) => ({
          id: run.id,
          status: run.status,
          ...(run.builds === undefined
            ? {}
            : { sourcePlanRef: { threadId: THREAD_ID, planId: run.builds } }),
        })),
      }) as never;
    // A plan that only waits is not something built (its runId is the turn that wrote it).
    assert.isFalse(
      SkycotFamilyGate.builtAndNoPlanWaiting(
        at([["plan-1", "run-1"]], [{ id: "run-1", status: "completed" }]),
      ),
    );
    // Built: a later tweak may skip the plan.
    const built = at(
      [["plan-1", "run-1"]],
      [
        { id: "run-1", status: "completed" },
        { id: "run-2", status: "completed", builds: "plan-1" },
      ],
    );
    assert.isTrue(SkycotFamilyGate.builtAndNoPlanWaiting(built));
    // Built once, but a newer plan waits for Build it: the tweak plans.
    assert.isFalse(
      SkycotFamilyGate.builtAndNoPlanWaiting(
        at(
          [
            ["plan-1", "run-1"],
            ["plan-2", "run-3"],
          ],
          [
            { id: "run-1", status: "completed" },
            { id: "run-2", status: "completed", builds: "plan-1" },
            { id: "run-3", status: "completed" },
          ],
        ),
      ),
    );
    // A build that was taken back does not count.
    assert.isFalse(
      SkycotFamilyGate.builtAndNoPlanWaiting(
        at(
          [["plan-1", "run-1"]],
          [
            { id: "run-1", status: "completed" },
            { id: "run-2", status: "rolled_back", builds: "plan-1" },
          ],
        ),
      ),
    );
  });

  it("a plan builds only while it waits and its turn still stands", () => {
    const projection = (planStatus: string, runStatus: string) =>
      ({
        plans: [proposedPlan("plan-1", "run-1", planStatus)],
        runs: [{ id: "run-1", status: runStatus }],
      }) as never;
    assert.isTrue(SkycotFamilyGate.planStillBuildable(projection("active", "completed"), "plan-1"));
    assert.isFalse(
      SkycotFamilyGate.planStillBuildable(projection("active", "rolled_back"), "plan-1"),
    );
    for (const status of ["completed", "superseded", "draft"]) {
      assert.isFalse(
        SkycotFamilyGate.planStillBuildable(projection(status, "completed"), "plan-1"),
      );
    }
    assert.isFalse(
      SkycotFamilyGate.planStillBuildable(projection("active", "completed"), "plan-2"),
    );
    assert.deepEqual(
      SkycotFamilyGate.sourcePlanOf({ sourcePlanRef: { threadId: "t", planId: "p" } }),
      { threadId: "t", planId: "p" },
    );
    assert.isNull(SkycotFamilyGate.sourcePlanOf({ sourcePlanRef: { planId: "p" } }));
  });

  it("a Build it sent while another turn is going or lined up plans instead of building", () => {
    const at = (status: string) =>
      ({
        plans: [proposedPlan("plan-1", "run-1")],
        runs: [
          { id: "run-1", status: "completed" },
          { id: "run-2", status },
        ],
        turnItems: [{ type: "proposed_plan", planId: "plan-1", ordinal: 1 }],
      }) as never;
    for (const status of ["preparing", "queued", "starting", "running", "waiting"]) {
      assert.isFalse(SkycotFamilyGate.planStillBuildable(at(status), "plan-1"), status);
    }
    for (const status of ["completed", "interrupted", "failed", "cancelled", "rolled_back"]) {
      assert.isTrue(SkycotFamilyGate.planStillBuildable(at(status), "plan-1"), status);
    }
  });

  it("a plan overtaken by later file changes plans again instead of building", () => {
    const at = (laterRun: string, changeRun = "run-2") =>
      ({
        plans: [proposedPlan("plan-1", "run-1")],
        runs: [
          { id: "run-1", status: "completed" },
          { id: "run-2", status: laterRun },
        ],
        turnItems: [
          { type: "proposed_plan", planId: "plan-1", runId: "run-1", ordinal: 100 },
          { type: "file_change", runId: changeRun, ordinal: changeRun === "run-1" ? 101 : 200 },
        ],
      }) as never;
    assert.isFalse(SkycotFamilyGate.planStillBuildable(at("completed"), "plan-1"));
    assert.isTrue(SkycotFamilyGate.planStillBuildable(at("rolled_back"), "plan-1"));
    assert.isTrue(SkycotFamilyGate.planStillBuildable(at("completed", "run-1"), "plan-1"));
  });

  it("only the newest plan builds: an older plan plans again while a later one stands", () => {
    const planItem = (planId: string, ordinal: number) => ({
      type: "proposed_plan",
      planId,
      ordinal,
    });
    const at = (laterRun: string) =>
      ({
        plans: [proposedPlan("plan-1", "run-1"), proposedPlan("plan-2", "run-2")],
        runs: [
          { id: "run-1", status: "completed" },
          { id: "run-2", status: laterRun },
        ],
        turnItems: [planItem("plan-1", 1), planItem("plan-2", 2)],
      }) as never;
    // The newer plan can build; the older one cannot while the newer one stands.
    assert.isTrue(SkycotFamilyGate.planStillBuildable(at("completed"), "plan-2"));
    assert.isFalse(SkycotFamilyGate.planStillBuildable(at("completed"), "plan-1"));
    // A newer plan whose turn was taken back does not count.
    assert.isTrue(SkycotFamilyGate.planStillBuildable(at("rolled_back"), "plan-1"));
    // A newer plan that was itself built still replaces the older one for good.
    const built = {
      plans: [proposedPlan("plan-1", "run-1"), proposedPlan("plan-2", "run-2", "completed")],
      runs: [
        { id: "run-1", status: "completed" },
        { id: "run-2", status: "completed" },
      ],
      turnItems: [planItem("plan-1", 1), planItem("plan-2", 2)],
    } as never;
    assert.isFalse(SkycotFamilyGate.planStillBuildable(built, "plan-1"));
  });

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

  it.effect("keeps a child's file reads inside SKYCOT's projects and private copies", () => {
    const copy = "/Users/kid/.t3/worktrees/space-game-copy";
    return withGate(
      [],
      ({ gate, family }) =>
        Effect.gen(function* () {
          const read = (payload: unknown, method = "projects.readFile") =>
            refused(gate.check({ sessionId: SESSION, method, payload }));
          // Off: nothing is gated.
          assert.isFalse(yield* read({ cwd: "/", relativePath: "etc/passwd" }));
          yield* family.enable({ code: CODE, childName: null });
          assert.isFalse(yield* read({ cwd: ROOT, relativePath: "index.html" }));
          assert.isFalse(yield* read({ cwd: `${ROOT}/pictures`, relativePath: "cat.png" }));
          assert.isFalse(yield* read({ cwd: copy, relativePath: "rockets.html" }));
          assert.isFalse(yield* read({ cwd: ROOT }, "projects.listEntries"));
          for (const payload of [
            { cwd: ROOT, relativePath: "/Users/kid/Documents/diary.txt" },
            { cwd: ROOT, relativePath: "../../Documents/diary.txt" },
            { cwd: ROOT, relativePath: "~/Documents/diary.txt" },
            { cwd: ROOT, relativePath: ".env" },
            { cwd: ROOT, relativePath: ".git/config" },
            { cwd: "/Users/kid/Documents", relativePath: "diary.txt" },
            { cwd: "/Users/kid/projects/space-game-secret", relativePath: "x.txt" },
          ]) {
            assert.isTrue(yield* read(payload), JSON.stringify(payload));
          }
          assert.isTrue(yield* read({ cwd: "/Users/kid" }, "projects.listEntries"));
          assert.isTrue(yield* read({ cwd: "/", query: "diary" }, "projects.searchEntries"));
          assert.isTrue(
            yield* read(
              { resource: { _tag: "media-file", threadId: THREAD_ID, path: "/Users/kid/me.jpg" } },
              "assets.createUrl",
            ),
          );
          const reveal = { cwd: `${ROOT}/cat.png`, editor: "file-manager", reveal: true };
          assert.isTrue(yield* read(reveal, "shell.openInEditor"));

          yield* family.verify({ code: CODE, purpose: "files", sessionId: SESSION });
          assert.isFalse(yield* read({ cwd: ROOT, relativePath: ".env" }));
          assert.isFalse(yield* read({ cwd: "/Users/kid/Documents", relativePath: "diary.txt" }));
          assert.isFalse(yield* read(reveal, "shell.openInEditor"));
          // An editor is still the developer tools'.
          assert.isFalse(yield* read({ cwd: ROOT, editor: "vscode" }, "shell.openInEditor"));
        }),
      copy,
    );
  });

  it.effect("judges a symlinked folder by where it really is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-gate-links-" });
      const project = path.join(dir, "pets");
      const outside = path.join(dir, "documents");
      yield* fs.makeDirectory(path.join(project, "pictures"), { recursive: true });
      yield* fs.makeDirectory(outside, { recursive: true });
      yield* fs.symlink(outside, path.join(project, "sneaky"));
      yield* withGate(
        [],
        ({ gate, family }) =>
          Effect.gen(function* () {
            yield* family.enable({ code: CODE, childName: null });
            const list = (cwd: string) =>
              refused(
                gate.check({
                  sessionId: SESSION,
                  method: "projects.listEntries",
                  payload: { cwd },
                }),
              );
            assert.isFalse(yield* list(path.join(project, "pictures")));
            assert.isTrue(yield* list(path.join(project, "sneaky")));
          }),
        null,
        WAITING_PLAN,
        [project],
      );
    }).pipe(Effect.scoped),
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
        assert.isTrue(Exit.isSuccess(yield* call("projects.list")));
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

  it.effect(
    "going back is not a message; the changed message counts and sleeps like any other",
    () =>
      withGate([], ({ gate, family, limits }) =>
        Effect.gen(function* () {
          yield* setUp(family);
          const goBackCall = {
            sessionId: SESSION,
            method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            payload: goBack(true),
          };
          yield* at("2026-10-22T09:00:00+11:00");
          yield* gate.check(goBackCall);
          yield* gate.check({ ...goBackCall, payload: goBack(false) });
          assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.turns, 0);
          // The changed message is the day's first message.
          yield* gate.check({ sessionId: SESSION, ...message() });
          assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.turns, 1);
          yield* gate.check({ sessionId: SESSION, ...message() });
          yield* gate.check({ sessionId: SESSION, ...message() });
          // At the day's cap, going back still works (like Undo); the changed message waits.
          yield* gate.check(goBackCall);
          const capped = yield* Effect.flip(gate.check({ sessionId: SESSION, ...message() }));
          assert.include(capped.message, "today's 3 messages");
          // At bedtime too.
          yield* at("2026-10-22T20:00:00+11:00");
          yield* gate.check(goBackCall);
          const asleep = yield* Effect.flip(gate.check({ sessionId: SESSION, ...message() }));
          assert.equal(asleep.requiredPermission, SkycotFamilyGate.FAMILY_ASLEEP_PERMISSION);
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
