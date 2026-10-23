import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ClaudeAdapterV2 from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as SkycotFamilyClaude from "./SkycotFamilyClaude.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

const lockdown = new SkycotFamilyLockdown.FamilyLockdown(ClaudeAdapterV2.CLAUDE_PROVIDER);
const DEFAULT_CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const modelSelection = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-sonnet-4-6",
} satisfies ModelSelection;
const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "approval-required",
  interactionMode: "default",
  cwd: "/workspace",
});

describe("SkycotFamilyClaude.lockQueryOptions", () => {
  it("is the same options while the profile is off", () => {
    const options = { settingSources: ["user", "project", "local"] as const, env: { A: "1" } };
    assert.strictEqual(SkycotFamilyClaude.lockQueryOptions(null, options), options);
  });

  it("reads no settings, no MCP server but SKYCOT's, no plugin, skill, hook or Chrome", () => {
    const options: SkycotFamilyClaude.ClaudeLockableOptions = {
      settings: { showThinkingSummaries: true },
      env: { PATH: "/usr/bin" },
      extraArgs: { "thinking-display": "summarized" },
    };
    const locked = SkycotFamilyClaude.lockQueryOptions(lockdown, options);
    assert.deepEqual(locked.settingSources, []);
    assert.isTrue(locked.strictMcpConfig);
    assert.deepEqual(locked.plugins, []);
    assert.deepEqual(locked.skills, []);
    assert.deepEqual(locked.settings, { showThinkingSummaries: true, disableAllHooks: true });
    assert.deepEqual(locked.env, { PATH: "/usr/bin", ENABLE_CLAUDEAI_MCP_SERVERS: "false" });
    assert.deepEqual(locked.extraArgs, { "thinking-display": "summarized", "no-chrome": null });
  });

  it("does not trust a settings file path", () => {
    const options: SkycotFamilyClaude.ClaudeLockableOptions = { settings: "/tmp/s.json" };
    const locked = SkycotFamilyClaude.lockQueryOptions(lockdown, options);
    assert.deepEqual(locked.settings, { disableAllHooks: true });
  });
});

describe("ClaudeAdapterV2 under the Family lockdown", () => {
  const openAndStartTurn = (withLockdown: boolean) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const opened: Array<ClaudeAdapterV2.ClaudeAgentSdkQueryOptions> = [];
      const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
        instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CLAUDE_SETTINGS,
        environment: {},
        attachmentsDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-claude-" }),
        fileSystem,
        path: yield* Path.Path,
        crypto: yield* Crypto.Crypto,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        queryRunner: {
          allocateSessionId: Effect.succeed("native-thread-family-lockdown"),
          open: (input) =>
            Effect.sync(() => {
              opened.push(input.options);
              return {
                messages: Stream.never,
                offer: () => Effect.void,
                setModel: () => Effect.void,
                applyFlagSettings: () => Effect.void,
                setPermissionMode: () => Effect.void,
                backgroundTasks: () => Effect.succeed(false),
                stopTask: () => Effect.void,
                interrupt: Effect.void,
                close: Effect.void,
              };
            }),
          forkSession: () => Effect.die("unused"),
          subagentLaunchToolUseId: () => Effect.succeed(null),
          assertComplete: Effect.void,
        },
      });
      const threadId = ThreadId.make("thread-claude-family-lockdown");
      const open = adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("provider-session-claude-family-lockdown"),
        modelSelection,
        runtimePolicy,
      });
      const runtime = yield* withLockdown
        ? open.pipe(Effect.provideService(SkycotFamilyLockdown.FamilyLockdownRef, lockdown))
        : open;
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const attemptId = RunAttemptId.make("attempt-claude-family-lockdown");
      yield* runtime.startTurn({
        appThread: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project-claude-family-lockdown"),
          title: "Family lockdown",
          providerInstanceId: modelSelection.instanceId,
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
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
        threadId,
        runId: RunId.make("run-claude-family-lockdown"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId,
        rootNodeId: NodeId.make("node-claude-family-lockdown"),
        providerThread,
        message: {
          createdBy: "user",
          creationSource: "web",
          messageId: MessageId.make("message-claude-family-lockdown"),
          text: "Make a page.",
          attachments: [],
        },
        modelSelection,
        runtimePolicy,
      });
      return opened;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
    );

  it.effect("opens a Family session's queries without the parent's Claude setup", () =>
    Effect.gen(function* () {
      const opened = yield* openAndStartTurn(true);
      assert.isAbove(opened.length, 0);
      for (const options of opened) {
        assert.deepEqual(options.settingSources, []);
        assert.isTrue(options.strictMcpConfig);
        assert.deepEqual(options.plugins, []);
        assert.deepEqual(options.skills, []);
        assert.strictEqual(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
        assert.property(options.extraArgs ?? {}, "no-chrome");
      }
    }),
  );

  it.effect("changes nothing while the profile is off", () =>
    Effect.gen(function* () {
      const opened = yield* openAndStartTurn(false);
      assert.isAbove(opened.length, 0);
      for (const options of opened) {
        assert.isUndefined(options.settingSources);
        assert.isUndefined(options.strictMcpConfig);
        assert.isUndefined(options.plugins);
        assert.notProperty(options.extraArgs ?? {}, "no-chrome");
      }
    }),
  );
});
