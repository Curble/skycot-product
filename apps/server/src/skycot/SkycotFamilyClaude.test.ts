// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
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
  platform: "darwin",
  uid: 501,
} as const;

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
    // The whole home folder, every account, external drives and the shared temporary folders.
    for (const place of [
      "/Users/kid",
      "/Users",
      "/Volumes",
      "/private/tmp",
      "/private/var/folders",
      "/Users/kid/.skycot",
      "/Users/kid/.ssh",
      "/Users/kid/.claude",
    ]) {
      assert.include(sandbox.filesystem?.denyRead ?? [], place);
    }
    for (const place of [
      "/Users/kid/.skycot/userdata",
      "/Users/kid/.skycot/bin",
      "/Users/kid/.skycot/origin-secret.txt",
      "/Users/kid/SKYCOT/my-game/.git",
      "/Users/kid/SKYCOT/my-game/.codex",
      "/Users/kid/SKYCOT/my-game/.agents",
      "/private/tmp/claude-501",
    ]) {
      assert.include(sandbox.filesystem?.denyWrite ?? [], place);
    }
    // Only the project comes back (and the temporary folder, when there is one).
    assert.deepEqual(sandbox.filesystem?.allowRead, ["/Users/kid/SKYCOT/my-game"]);
  });

  it("reads a question's folder inside SKYCOT's home again, and the conversation's temporary folder", () => {
    const cwd = "/Users/kid/.skycot/scratch/what-is-a-star";
    const options: SkycotFamilyClaude.ClaudeLockableOptions = { cwd, env: { PATH: "/usr/bin" } };
    const locked = SkycotFamilyClaude.lockQueryOptions(lockdown, options, {
      ...places,
      tmpDir: "/private/tmp/skycot-501/abc123",
    });
    assert.include(locked.sandbox?.filesystem?.denyRead ?? [], "/Users/kid/.skycot");
    assert.deepEqual(locked.sandbox?.filesystem?.allowRead, [
      cwd,
      "/private/tmp/skycot-501/abc123",
    ]);
    assert.equal(locked.env?.CLAUDE_CODE_TMPDIR, "/private/tmp/skycot-501/abc123");
  });

  it("gives sandboxed commands only the environment a build needs", () => {
    const locked = lock({
      env: {
        PATH: "/usr/bin",
        HOME: "/Users/kid",
        LC_ALL: "en_AU.UTF-8",
        NVM_DIR: "/Users/kid/.nvm",
        GITHUB_TOKEN: "x",
        OPENAI_API_KEY: "y",
        STRIPE_KEY: "z",
        HF_PAT: "p",
        SSH_AUTH_SOCK: "/private/tmp/agent.sock",
        npm_config_registry: "https://evil.example",
      },
    });
    const hidden = (locked.sandbox?.credentials?.envVars ?? []).map((entry) => {
      assert.equal(entry.mode, "deny");
      return entry.name;
    });
    for (const name of [
      "GITHUB_TOKEN",
      "OPENAI_API_KEY",
      "STRIPE_KEY",
      "HF_PAT",
      "SSH_AUTH_SOCK",
      "npm_config_registry",
      "ENABLE_CLAUDEAI_MCP_SERVERS",
    ]) {
      assert.include(hidden, name);
    }
    for (const name of [
      "PATH",
      "HOME",
      "LC_ALL",
      "NVM_DIR",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
    ]) {
      assert.notInclude(hidden, name);
    }
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
    assert.deepEqual(locked.env, {
      PATH: "/usr/bin",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.excludesFile",
      GIT_CONFIG_VALUE_0: "/dev/null",
    });
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
    claudeVersion: string | null = "2.1.296 (Claude Code)",
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
        familyClaudeVersion: () => Effect.succeed(claudeVersion),
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

  it.effect(
    "does not start a child's Claude older than the first one with every sandbox setting",
    () =>
      Effect.gen(function* () {
        for (const version of ["2.0.14 (Claude Code)", "2.1.275 (Claude Code)", null, "huh"]) {
          const failed = yield* runTurn(
            true,
            (opened) => Effect.succeed(opened),
            true,
            version,
          ).pipe(Effect.flip);
          assert.equal(
            userFacingDispatchErrorMessage(failed),
            SkycotFamilyClaude.FAMILY_CLAUDE_TOO_OLD_REFUSAL,
            String(version),
          );
        }
        // A grown-up's Claude is not asked its version at all.
        const opened = yield* runTurn(false, (opened) => Effect.succeed(opened), true, null);
        assert.isAbove(opened.length, 0);
      }),
  );

  it.effect("gives each Family conversation its own temporary folder, gone when it ends", () =>
    Effect.gen(function* () {
      const seen = yield* runTurn(true, (opened) =>
        Effect.sync(() => {
          const dir = opened[0]!.env?.CLAUDE_CODE_TMPDIR;
          assert.isString(dir);
          assert.match(dir!, /\/skycot-\d+\/[^/]+$/);
          const stat = NodeFS.statSync(dir!);
          assert.equal(stat.mode & 0o777, 0o700);
          assert.include(opened[0]!.sandbox?.filesystem?.allowRead ?? [], dir!);
          return dir!;
        }),
      );
      assert.isFalse(NodeFS.existsSync(seen));
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
    const root = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "skycot-tools-")),
    );
    try {
      const project = NodePath.join(root, "my-game");
      const outside = NodePath.join(root, "secrets");
      const attachments = NodePath.join(root, "attachments");
      for (const dir of [project, outside, attachments]) NodeFS.mkdirSync(dir);
      NodeFS.writeFileSync(NodePath.join(outside, "key"), "x");
      NodeFS.symlinkSync(outside, NodePath.join(project, "link"));
      NodeFS.symlinkSync(
        NodePath.join(outside, "LaunchAgents", "com.example.plist"),
        NodePath.join(project, "dangling.plist"),
      );
      NodeFS.symlinkSync(NodePath.join(outside, "not-yet"), NodePath.join(project, "dangling-dir"));
      run({ project, outside, attachments });
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
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
      // Only the folders themselves: names that merely start the same way are the child's.
      assert.isNull(refusal(dirs, "Write", { file_path: "codex/notes.md", content: "" }));
      assert.isNull(refusal(dirs, "Write", { file_path: ".codexrc", content: "" }));
      assert.isNull(refusal(dirs, "Write", { file_path: "src/.agents/x", content: "" }));
      // Reading them is fine (Codex and SKYCOT read them anyway).
      assert.isNull(refusal(dirs, "Read", { file_path: ".codex/config.toml" }));
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
        // The assistants' own project settings (S1): Codex's config and hooks, skills.
        ["Write", { file_path: NodePath.join(dirs.project, ".codex", "config.toml"), content: "" }],
        ["Write", { file_path: NodePath.join(dirs.project, ".CODEX", "config.toml"), content: "" }],
        ["Edit", { file_path: NodePath.join(dirs.project, ".Agents", "skills", "x", "SKILL.md") }],
        ["Write", { file_path: NodePath.join(dirs.project, ".agents"), content: "" }],
        ["SomeNewTool", { path: dirs.outside }],
        // A link whose target is not there yet: a write would land wherever it points.
        ["Write", { file_path: NodePath.join(dirs.project, "dangling.plist"), content: "" }],
        ["Write", { file_path: NodePath.join(dirs.project, "dangling-dir", "x.js"), content: "" }],
        ["Read", { file_path: NodePath.join(dirs.project, "dangling.plist") }],
      ] as const) {
        assert.equal(
          refusal(dirs, toolName, toolInput),
          SkycotFamilyClaude.FAMILY_OUTSIDE_PROJECT_MESSAGE,
          `${toolName} ${JSON.stringify(toolInput)}`,
        );
      }
    }));
});

describe("SkycotFamilyClaude.claudeVersionSupportsFamily", () => {
  it("lets a child's Claude run only on a Claude Code that knows every sandbox setting", () => {
    assert.isTrue(SkycotFamilyClaude.claudeVersionSupportsFamily("2.1.296 (Claude Code)"));
    assert.isTrue(SkycotFamilyClaude.claudeVersionSupportsFamily("2.1.276"));
    assert.isTrue(SkycotFamilyClaude.claudeVersionSupportsFamily("3.0.0 (Claude Code)"));
    for (const old of ["2.1.275", "2.0.99", "1.9.300", "", null, undefined, "Claude Code"]) {
      assert.isFalse(SkycotFamilyClaude.claudeVersionSupportsFamily(old), String(old));
    }
  });
});

describe("SkycotFamilyClaude.familySandboxAvailable", () => {
  it("needs sandbox-exec on macOS and bubblewrap with socat on Linux, and nothing else runs", () => {
    assert.isTrue(
      SkycotFamilyClaude.familySandboxAvailable(
        "darwin",
        "/usr/bin",
        (p) => p === "/usr/bin/sandbox-exec",
      ),
    );
    assert.isFalse(SkycotFamilyClaude.familySandboxAvailable("darwin", "/usr/bin", () => false));
    const linux = (has: ReadonlyArray<string>) =>
      SkycotFamilyClaude.familySandboxAvailable("linux", "/usr/bin", (p) => has.includes(p));
    assert.isTrue(linux(["/usr/bin/bwrap", "/usr/bin/socat"]));
    assert.isFalse(linux(["/usr/bin/bwrap"]));
    assert.isFalse(SkycotFamilyClaude.familySandboxAvailable("win32", "/usr/bin", () => true));
  });
});
