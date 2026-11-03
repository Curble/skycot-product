// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

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
import type * as Scope from "effect/Scope";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ClaudeAdapterV2 from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { userFacingDispatchErrorMessage } from "../orchestration-v2/UserFacingErrors.ts";
import * as SkycotFamilyClaude from "./SkycotFamilyClaude.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

type FamilyRuntime = ProviderAdapter.ProviderAdapterV2SessionRuntime;
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

const places = {
  home: "/Users/kid",
  engineHome: "/Users/kid/.skycot",
  stateDir: "/Users/kid/.skycot/userdata",
};

const lock = (options: SkycotFamilyClaude.ClaudeLockableOptions) =>
  SkycotFamilyClaude.lockQueryOptions(lockdown, options, places);

describe("SkycotFamilyClaude.lockQueryOptions", () => {
  it("is the same options while the profile is off", () => {
    const options = { settingSources: ["user", "project", "local"] as const, env: { A: "1" } };
    assert.strictEqual(SkycotFamilyClaude.lockQueryOptions(null, options, places), options);
  });

  it("runs every command in a sandbox SKYCOT's callback still judges, with no way out", () => {
    const locked = lock({ cwd: "/Users/kid/SKYCOT/my-game", env: { PATH: "/usr/bin" } });
    const sandbox = locked.sandbox!;
    assert.include(sandbox, {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      allowAppleEvents: false,
    });
    assert.deepEqual(sandbox.excludedCommands, []);
    assert.deepInclude(sandbox.network, {
      allowedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    });
    assert.deepEqual(sandbox.filesystem?.allowWrite, []);
    for (const secret of [
      "/Users/kid/.skycot",
      "/Users/kid/.skycot-family",
      "/Users/kid/.ssh",
      "/Users/kid/.aws",
      "/Users/kid/.gnupg",
      "/Users/kid/.config/gh",
      "/Users/kid/Library/Keychains",
      "/Users/kid/.codex",
      "/Users/kid/.claude",
      "/Users/kid/.netrc",
      "/Users/kid/.skycot/userdata",
    ]) {
      assert.include(sandbox.filesystem?.denyRead ?? [], secret);
    }
    for (const place of [
      "/Users/kid/.skycot/userdata",
      "/Users/kid/.skycot/bin",
      "/Users/kid/.skycot/origin-secret.txt",
      "/Users/kid/SKYCOT/my-game/.git/hooks",
      "/Users/kid/SKYCOT/my-game/.git/config",
    ]) {
      assert.include(sandbox.filesystem?.denyWrite ?? [], place);
    }
    // The project is not inside any place above, so nothing is read-allowed again.
    assert.deepEqual(sandbox.filesystem?.allowRead, []);
  });

  it("reads a question's folder inside SKYCOT's home again, and nothing beside it", () => {
    const cwd = "/Users/kid/.skycot/scratch/what-is-a-star";
    const locked = lock({ cwd });
    assert.include(locked.sandbox?.filesystem?.denyRead ?? [], "/Users/kid/.skycot");
    assert.deepEqual(locked.sandbox?.filesystem?.allowRead, [cwd]);
  });

  it("keeps the grown-up's keys in the environment away from sandboxed commands", () => {
    const locked = lock({
      env: { PATH: "/usr/bin", GITHUB_TOKEN: "x", OPENAI_API_KEY: "y", HOME: "/Users/kid" },
    });
    assert.deepEqual(locked.sandbox?.credentials?.envVars, [
      { name: "GITHUB_TOKEN", mode: "deny" },
      { name: "OPENAI_API_KEY", mode: "deny" },
    ]);
  });

  it("asks before every step (or plans) whatever the grown-up's launch arguments say", () => {
    const locked = lock({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      extraArgs: { "mcp-config": "/Users/me/servers.json", "add-dir": "/Users/me" },
    });
    assert.equal(locked.permissionMode, "default");
    assert.isFalse(locked.allowDangerouslySkipPermissions);
    assert.deepEqual(locked.extraArgs, { "no-chrome": null });
    const planning = lock({ permissionMode: "plan" });
    assert.equal(planning.permissionMode, "plan");
  });

  it("reads no settings, no MCP server but SKYCOT's, no plugin, skill, hook or Chrome", () => {
    const options: SkycotFamilyClaude.ClaudeLockableOptions = {
      settings: { showThinkingSummaries: true },
      env: { PATH: "/usr/bin" },
      extraArgs: { "thinking-display": "summarized" },
    };
    const locked = SkycotFamilyClaude.lockQueryOptions(lockdown, options, places);
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
    const locked = SkycotFamilyClaude.lockQueryOptions(lockdown, options, places);
    assert.deepEqual(locked.settings, { disableAllHooks: true });
  });
});

describe("ClaudeAdapterV2 under the Family lockdown", () => {
  const runTurn = <A, E>(
    withLockdown: boolean,
    use: (
      opened: Array<ClaudeAdapterV2.ClaudeAgentSdkQueryOptions>,
      runtime: FamilyRuntime,
    ) => Effect.Effect<A, E, Scope.Scope>,
    sandboxAvailable = true,
  ) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const opened: Array<ClaudeAdapterV2.ClaudeAgentSdkQueryOptions> = [];
      const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
        instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CLAUDE_SETTINGS,
        environment: {},
        attachmentsDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-claude-" }),
        engineHome: "/Users/kid/.skycot",
        familySandboxAvailable: () => sandboxAvailable,
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
      return yield* use(opened, runtime);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
    );

  const openAndStartTurn = (withLockdown: boolean) =>
    runTurn(withLockdown, (opened) => Effect.succeed(opened));

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
        assert.include(options.sandbox, {
          enabled: true,
          failIfUnavailable: true,
          allowUnsandboxedCommands: false,
          autoAllowBashIfSandboxed: false,
        });
        assert.include(options.sandbox?.filesystem?.denyRead ?? [], "/Users/kid/.skycot");
        assert.equal(options.permissionMode, "default");
      }
    }),
  );

  it.effect("does not start a child's Claude when its sandbox can't start", () =>
    Effect.gen(function* () {
      const failed = yield* runTurn(true, (opened) => Effect.succeed(opened), false).pipe(
        Effect.flip,
      );
      assert.equal(
        userFacingDispatchErrorMessage(failed),
        SkycotFamilyClaude.FAMILY_CLAUDE_SANDBOX_REFUSAL,
      );
    }),
  );

  it.effect("refuses Claude's own file tools outside the project, before any card", () =>
    runTurn(true, (opened) =>
      Effect.gen(function* () {
        for (const [toolName, toolInput] of [
          ["Read", { file_path: "/Users/kid/.skycot/userdata/skycot-family.json" }],
          ["Read", { file_path: "/workspace/../Users/kid/.ssh/id_rsa" }],
          ["Write", { file_path: "/Users/kid/.zshrc", content: "x" }],
          ["Edit", { file_path: "/workspace/.git/hooks/pre-commit" }],
          ["Glob", { pattern: "/Users/kid/**/*.json" }],
          ["Grep", { pattern: "token", path: "/Users/kid" }],
        ] as const) {
          const answer = yield* Effect.promise(() =>
            opened[0]!.canUseTool!(toolName, toolInput, {
              signal: new AbortController().signal,
              toolUseID: `outside-${toolName}`,
              requestId: `request-outside-${toolName}`,
            }),
          );
          assert.deepInclude(answer, {
            behavior: "deny",
            message: SkycotFamilyClaude.FAMILY_OUTSIDE_PROJECT_MESSAGE,
          });
        }
      }),
    ),
  );

  it.effect("a note SKYCOT leaves with a decline is what the assistant reads", () =>
    runTurn(true, (opened, runtime) =>
      Effect.gen(function* () {
        const one = yield* ask(opened, runtime, "tool-installed");
        if (one.first.type !== "card") return assert.fail("expected a card");
        const event = one.first.event;
        if (Option.isNone(event) || event.value.type !== "runtime_request.updated") return;
        const note = "SKYCOT note: it was approved, so SKYCOT installed lodash for you.";
        yield* runtime.respondToRuntimeRequest({
          requestId: event.value.runtimeRequest.id,
          decision: "decline",
          answers: { [SkycotFamilyClaude.ASSISTANT_NOTE_ANSWER]: note },
        });
        assert.deepInclude(yield* Fiber.join(one.answer), { behavior: "deny", message: note });
        // Not remembered as a family "no": the same step raises a card again.
        const two = yield* ask(opened, runtime, "tool-installed-again");
        assert.equal(two.first.type, "card");
      }),
    ),
  );

  const install = { command: "npm install lodash" };

  // Asks for the step through the live permission callback; resolves to the raised card's
  // request id, or to the immediate answer when no card was raised.
  const ask = (
    opened: Array<ClaudeAdapterV2.ClaudeAgentSdkQueryOptions>,
    runtime: FamilyRuntime,
    toolUseID: string,
  ) =>
    Effect.gen(function* () {
      const card = yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "runtime_request.updated"),
        Stream.runHead,
        Effect.forkScoped,
      );
      const answer = yield* Effect.promise(() =>
        opened[0]!.canUseTool!("Bash", install, {
          signal: new AbortController().signal,
          toolUseID,
          requestId: `request-${toolUseID}`,
        }),
      ).pipe(Effect.forkScoped);
      const first = yield* Effect.raceFirst(
        Fiber.join(card).pipe(Effect.map((event) => ({ type: "card", event }) as const)),
        Fiber.join(answer).pipe(Effect.map((result) => ({ type: "answer", result }) as const)),
      );
      return { first, answer };
    });

  it.effect("a no carries on without the step, and the same step is not asked twice", () =>
    runTurn(true, (opened, runtime) =>
      Effect.gen(function* () {
        const one = yield* ask(opened, runtime, "tool-1");
        assert.equal(one.first.type, "card");
        if (one.first.type !== "card") return;
        const event = one.first.event;
        if (Option.isNone(event) || event.value.type !== "runtime_request.updated") return;
        yield* runtime.respondToRuntimeRequest({
          requestId: event.value.runtimeRequest.id,
          decision: "decline",
        });
        const declined = yield* Fiber.join(one.answer);
        assert.deepInclude(declined, {
          behavior: "deny",
          message: SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE,
        });
        // The identical step again: refused at once, no new card.
        const two = yield* ask(opened, runtime, "tool-2");
        assert.equal(two.first.type, "answer");
        if (two.first.type !== "answer") return;
        assert.deepInclude(two.first.result, {
          behavior: "deny",
          message: SkycotFamilyClaude.FAMILY_DECLINED_AGAIN_MESSAGE,
        });
      }),
    ),
  );

  it.effect("a grown-up's yes still lets the step run", () =>
    runTurn(true, (opened, runtime) =>
      Effect.gen(function* () {
        const one = yield* ask(opened, runtime, "tool-1");
        assert.equal(one.first.type, "card");
        if (one.first.type !== "card") return;
        const event = one.first.event;
        if (Option.isNone(event) || event.value.type !== "runtime_request.updated") return;
        yield* runtime.respondToRuntimeRequest({
          requestId: event.value.runtimeRequest.id,
          decision: "accept",
        });
        assert.equal((yield* Fiber.join(one.answer))?.behavior, "allow");
      }),
    ),
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
        assert.isUndefined(options.sandbox);
      }
    }),
  );
});

describe("SkycotFamilyClaude declined steps", () => {
  it("tells the assistant plainly to carry on, with no age and no way to say yes", () => {
    for (const message of [
      SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE,
      SkycotFamilyClaude.FAMILY_DECLINED_AGAIN_MESSAGE,
    ]) {
      assert.match(message, /family/);
      assert.match(message, /[Cc]arry on without it/);
      assert.notMatch(message, /child|kid|\d+-year|years? old/i);
    }
  });

  it("remembers a step for its own turn only", () => {
    const declined = new SkycotFamilyClaude.FamilyDeclinedSteps();
    declined.record("turn-1", "Bash", { command: "npm install lodash" });
    assert.isTrue(declined.has("turn-1", "Bash", { command: "npm install lodash" }));
    assert.isFalse(declined.has("turn-1", "Bash", { command: "npm install left-pad" }));
    assert.isFalse(declined.has("turn-1", "Write", { command: "npm install lodash" }));
    assert.isFalse(declined.has("turn-2", "Bash", { command: "npm install lodash" }));
  });

  it("only changes the decline words; a yes is still a yes", () => {
    const declined = ClaudeAdapterV2.permissionResultFromDecision({
      toolName: "Bash",
      decision: "decline",
      toolInput: { command: "npm install lodash" },
      toolUseID: "t1",
      declineMessage: SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE,
    });
    assert.equal(declined.behavior, "deny");
    if (declined.behavior === "deny") {
      assert.equal(declined.message, SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE);
    }
    const stopped = ClaudeAdapterV2.permissionResultFromDecision({
      toolName: "Bash",
      decision: "cancel",
      toolInput: {},
      toolUseID: "t2",
      declineMessage: SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE,
    });
    assert.equal(
      stopped.behavior === "deny" ? stopped.message : "",
      "User cancelled tool execution.",
    );
    const allowed = ClaudeAdapterV2.permissionResultFromDecision({
      toolName: "Bash",
      decision: "accept",
      toolInput: { command: "npm install lodash" },
      toolUseID: "t3",
      declineMessage: SkycotFamilyClaude.FAMILY_DECLINED_MESSAGE,
    });
    assert.equal(allowed.behavior, "allow");
  });
});

describe("SkycotFamilyClaude.fileToolRefusal", () => {
  const withProject = (
    run: (dirs: { project: string; outside: string; attachments: string }) => void,
  ) => {
    const root = NodeFs.realpathSync(
      NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "skycot-tools-")),
    );
    try {
      const project = NodePath.join(root, "my-game");
      const outside = NodePath.join(root, "secrets");
      const attachments = NodePath.join(root, "attachments");
      for (const dir of [project, outside, attachments]) NodeFs.mkdirSync(dir);
      NodeFs.writeFileSync(NodePath.join(outside, "key"), "x");
      NodeFs.symlinkSync(outside, NodePath.join(project, "link"));
      run({ project, outside, attachments });
    } finally {
      NodeFs.rmSync(root, { recursive: true, force: true });
    }
  };
  const refusal = (
    dirs: { project: string; attachments: string },
    toolName: string,
    toolInput: Record<string, unknown>,
  ) =>
    SkycotFamilyClaude.fileToolRefusal({
      toolName,
      toolInput,
      cwd: dirs.project,
      home: "/Users/kid",
      readRoots: [dirs.attachments],
    });

  it("lets the project's own files through to the rules", () =>
    withProject((dirs) => {
      assert.isNull(
        refusal(dirs, "Read", { file_path: NodePath.join(dirs.project, "index.html") }),
      );
      assert.isNull(refusal(dirs, "Write", { file_path: "sprites/new.png", content: "" }));
      assert.isNull(refusal(dirs, "Edit", { file_path: NodePath.join(dirs.project, "a/b/c.js") }));
      assert.isNull(refusal(dirs, "Glob", { pattern: "**/*.js" }));
      assert.isNull(refusal(dirs, "Grep", { pattern: "x" }));
      assert.isNull(refusal(dirs, "Read", { file_path: NodePath.join(dirs.attachments, "a.png") }));
      assert.isNull(refusal(dirs, "Bash", { command: "rm -rf /" }));
    }));

  it("refuses a symlink, `..`, `~` or an absolute path that leaves the project", () =>
    withProject((dirs) => {
      for (const [toolName, toolInput] of [
        ["Read", { file_path: NodePath.join(dirs.project, "link", "key") }],
        ["Write", { file_path: NodePath.join(dirs.project, "link", "new"), content: "" }],
        ["Read", { file_path: "../secrets/key" }],
        ["Read", { file_path: "~/.ssh/id_rsa" }],
        ["Read", { file_path: NodePath.join(dirs.outside, "key") }],
        ["Glob", { pattern: "**/../../secrets/*" }],
        ["Glob", { pattern: "*", path: dirs.outside }],
        ["LS", { path: dirs.outside }],
        ["NotebookEdit", { notebook_path: NodePath.join(dirs.outside, "n.ipynb") }],
        ["Write", { file_path: NodePath.join(dirs.attachments, "a.png"), content: "" }],
        ["Write", { file_path: NodePath.join(dirs.project, ".git", "hooks", "pre-commit") }],
        ["SomeNewTool", { path: dirs.outside }],
      ] as const) {
        assert.equal(
          refusal(dirs, toolName, toolInput),
          SkycotFamilyClaude.FAMILY_OUTSIDE_PROJECT_MESSAGE,
          `${toolName} ${JSON.stringify(toolInput)}`,
        );
      }
    }));
});

describe("SkycotFamilyClaude.familySandboxAvailable", () => {
  it("needs sandbox-exec on macOS and bubblewrap with socat on Linux, and nothing else runs", () => {
    assert.isTrue(
      SkycotFamilyClaude.familySandboxAvailable("darwin", (p) => p === "/usr/bin/sandbox-exec"),
    );
    assert.isFalse(SkycotFamilyClaude.familySandboxAvailable("darwin", () => false));
    const linux = (has: ReadonlyArray<string>) =>
      SkycotFamilyClaude.familySandboxAvailable("linux", (p) => has.includes(p), "/usr/bin");
    assert.isTrue(linux(["/usr/bin/bwrap", "/usr/bin/socat"]));
    assert.isFalse(linux(["/usr/bin/bwrap"]));
    assert.isFalse(SkycotFamilyClaude.familySandboxAvailable("win32", () => true));
  });
});
