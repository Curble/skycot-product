import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { makeReplayServerConfig } from "../orchestration-v2/Adapters/CodexAdapterV2.testkit.ts";
import * as SkycotFamilyCodex from "./SkycotFamilyCodex.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const lockdown = new SkycotFamilyLockdown.FamilyLockdown(CodexAdapterV2.CODEX_DRIVER_KIND);

/** What a parent's ~/.codex/config.toml looks like to Codex (the walkthrough Mac, trimmed). */
const PARENT_CONFIG = {
  features: { js_repl: false },
  notify: ["/Users/parent/.codex/computer-use/SkyComputerUseClient", "turn-ended"],
  plugins: { "computer-use@openai-bundled": { enabled: true } },
  mcp_servers: {
    node_repl: { command: "/Applications/ChatGPT.app/node_repl", enabled: true },
    "computer-use": { command: "./SkyComputerUseClient", enabled: false },
    "dot.name": { command: "/bin/true" },
  },
};
const PARENT_SKILLS = {
  data: [
    {
      cwd: "/workspace",
      skills: [
        {
          name: "codex-primary-runtime",
          scope: "user",
          path: "/Users/parent/.codex/skills/a/SKILL.md",
        },
        { name: "kite", scope: "repo", path: "/workspace/.agents/skills/kite/SKILL.md" },
        {
          name: "imagegen",
          scope: "system",
          path: "/Users/parent/.codex/skills/.system/imagegen/SKILL.md",
        },
      ],
    },
  ],
};

interface FakeCodex {
  readonly requests: Array<{ readonly method: string; readonly params: unknown }>;
  readonly notificationHandlers: Map<
    string,
    (payload: never) => Effect.Effect<void, { readonly message: string }>
  >;
}

/**
 * A pretend Codex app-server that behaves like the real one: Codex's switches show up in its
 * own `config/read`, and with plugins and apps off it lists none.
 */
function fakeCodexClient(
  launchArgs: string,
  fake: FakeCodex,
  overrides: { readonly configRead?: unknown } = {},
): CodexClient.CodexAppServerClient["Service"] {
  const locked = launchArgs.includes("features.plugins=false");
  const answer = (method: string): unknown => {
    switch (method) {
      case "initialize":
        return {
          userAgent: "fake",
          codexHome: "/fake",
          platformFamily: "unix",
          platformOs: "macos",
        };
      case "config/read":
        return "configRead" in overrides
          ? overrides.configRead
          : {
              config: locked
                ? {
                    ...PARENT_CONFIG,
                    notify: [],
                    features: Object.fromEntries(
                      SkycotFamilyCodex.FAMILY_CODEX_FEATURES_OFF.map((name) => [name, false]),
                    ),
                  }
                : PARENT_CONFIG,
              origins: {},
            };
      case "plugin/list":
        return locked
          ? { marketplaces: [] }
          : {
              marketplaces: [
                {
                  name: "bundled",
                  plugins: [{ id: "computer-use@openai-bundled", enabled: true }],
                },
              ],
            };
      case "app/list":
        return { data: locked ? [] : [{ id: "gmail", name: "Gmail", isEnabled: true }] };
      case "skills/list":
        return PARENT_SKILLS;
      case "thread/start":
      case "thread/resume":
        return { thread: { id: "native-family", createdAt: 1, updatedAt: 1 }, model: "gpt-5.4" };
      default:
        return {};
    }
  };
  const request = (method: string, params?: unknown) =>
    Effect.sync(() => {
      fake.requests.push({ method, params });
      return answer(method);
    });
  return {
    raw: {
      notifications: Stream.never,
      requests: Stream.never,
      request,
      notify: () => Effect.void,
      respond: () => Effect.void,
      respondError: () => Effect.void,
    },
    request: request as CodexClient.CodexAppServerClient["Service"]["request"],
    notify: () => Effect.void,
    handleServerRequest: () => Effect.void,
    handleServerNotification: (method, handler) =>
      Effect.sync(() => {
        fake.notificationHandlers.set(method, handler as never);
      }),
    handleUnknownServerRequest: () => Effect.void,
    handleUnknownServerNotification: () => Effect.void,
  };
}

const newFake = (): FakeCodex => ({ requests: [], notificationHandlers: new Map() });
const sent = (fake: FakeCodex, method: string) =>
  fake.requests.filter((request) => request.method === method).map((request) => request.params);

describe("SkycotFamilyCodex.lockLaunch", () => {
  it("leaves the launch alone while the profile is off", () => {
    const input = { settings: { launchArgs: "--foo" }, environment: { A: "1" } };
    assert.strictEqual(SkycotFamilyCodex.lockLaunch(null, input), input);
  });

  it("appends Codex's own switches after the instance's launch arguments", () => {
    const locked = SkycotFamilyCodex.lockLaunch(lockdown, {
      settings: { launchArgs: "--from-settings" },
      environment: { T3CODE_CODEX_LAUNCH_ARGS: "-c model=gpt-5.4" },
    });
    const args = locked.settings.launchArgs;
    assert.isTrue(args.startsWith("-c model=gpt-5.4 -c "));
    for (const expected of [
      "-c features.plugins=false",
      "-c features.apps=false",
      "-c features.hooks=false",
      "-c features.computer_use=false",
      "-c features.browser_use=false",
      "-c features.memories=false",
      "-c notify=[]",
      "-c skills.bundled.enabled=false",
    ]) {
      assert.include(args, expected);
    }
    assert.strictEqual(locked.environment.T3CODE_CODEX_LAUNCH_ARGS, args);
  });
});

describe("SkycotFamilyCodex.familyThreadConfig", () => {
  it("switches off every MCP server and skill the process knows, by name", () => {
    const config = SkycotFamilyCodex.familyThreadConfig(
      {
        "tools.update_plan.enabled": true,
        "mcp_servers.t3-code": { url: "http://127.0.0.1/mcp" },
      },
      {
        mcpServers: SkycotFamilyCodex.mcpServerNames({ config: PARENT_CONFIG }),
        skills: SkycotFamilyCodex.nonSystemSkills(PARENT_SKILLS),
      },
    );
    assert.isUndefined(config["mcp_servers.t3-code"]);
    assert.deepEqual(config.mcp_servers, {
      node_repl: { enabled: false },
      "computer-use": { enabled: false },
      "dot.name": { enabled: false },
    });
    assert.deepEqual(config["skills.config"], [
      { path: "/Users/parent/.codex/skills/a/SKILL.md", enabled: false },
      { path: "/workspace/.agents/skills/kite/SKILL.md", enabled: false },
    ]);
    assert.strictEqual(config["features.plugins"], false);
    assert.deepEqual(config.notify, []);
    assert.strictEqual(config["tools.update_plan.enabled"], true);
  });
});

describe("SkycotFamilyCodex.familyProcessProblems", () => {
  it("names what is still on in a parent's process and nothing in a locked one", () => {
    const parent = SkycotFamilyCodex.familyProcessProblems({
      configRead: { config: PARENT_CONFIG },
      pluginList: {
        marketplaces: [{ plugins: [{ id: "computer-use@openai-bundled", enabled: true }] }],
      },
      appList: { data: [{ id: "gmail", isEnabled: true }] },
    });
    assert.include(parent, "feature plugins is not off");
    assert.include(parent, "notify is set");
    assert.include(parent, "plugin computer-use@openai-bundled is enabled");
    assert.include(parent, "app gmail is enabled");
    const locked = SkycotFamilyCodex.familyProcessProblems({
      configRead: {
        config: {
          notify: [],
          features: Object.fromEntries(
            SkycotFamilyCodex.FAMILY_CODEX_FEATURES_OFF.map((name) => [name, false]),
          ),
        },
      },
      pluginList: { marketplaces: [] },
      appList: { data: [] },
    });
    assert.deepEqual(locked, []);
    assert.include(
      SkycotFamilyCodex.familyProcessProblems({ configRead: {}, pluginList: null, appList: null }),
      "plugin list unreadable",
    );
  });
});

describe("SkycotFamilyCodex.lockClient", () => {
  const lockedArgs = SkycotFamilyCodex.FAMILY_CODEX_LAUNCH_ARGS.join(" ");

  it.effect("is the same client while the profile is off", () =>
    Effect.sync(() => {
      const client = fakeCodexClient("", newFake());
      assert.strictEqual(SkycotFamilyCodex.lockClient(null, client), client);
    }),
  );

  it.effect("starts and resumes threads with every MCP server and skill off", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient(lockedArgs, fake));
      yield* client.request("thread/start", { cwd: "/workspace", config: { a: 1 } } as never);
      yield* client.raw.request("thread/resume", { threadId: "t", cwd: "/workspace" });
      for (const params of [...sent(fake, "thread/start"), ...sent(fake, "thread/resume")]) {
        const config = (params as { config: Record<string, unknown> }).config;
        assert.deepEqual(Object.keys(config.mcp_servers as object), [
          "node_repl",
          "computer-use",
          "dot.name",
        ]);
        assert.strictEqual(config["features.plugins"], false);
        assert.strictEqual(config["features.computer_use"], false);
        assert.deepEqual(config.notify, []);
        assert.lengthOf(config["skills.config"] as Array<unknown>, 2);
      }
      assert.deepEqual(sent(fake, "config/read").at(-1), { cwd: "/workspace" });
    }),
  );

  it.effect("refuses a thread when the process still has plugins on (fail closed)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      // Launched without the switches, as a process that ignored them would look.
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient("", fake));
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect("refuses a thread when Codex cannot report its config", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake, { configRead: null }),
      );
      const error = yield* client.request("thread/start", {} as never).pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect("never writes the parent's config or calls MCP tools", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient(lockedArgs, fake));
      for (const method of ["config/value/write", "plugin/install", "mcpServer/tool/call"]) {
        const result = yield* Effect.result(client.raw.request(method, {}));
        assert.strictEqual(
          result._tag === "Failure" ? result.failure.message : "sent",
          SkycotFamilyCodex.FAMILY_CODEX_REFUSAL,
        );
      }
      assert.lengthOf(fake.requests, 0);
    }),
  );

  it.effect("refuses turns once an MCP server starts for a locked thread anyway", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient(lockedArgs, fake));
      yield* client.request("thread/start", { cwd: "/workspace" } as never);
      yield* client.request("turn/start", { threadId: "t", input: [] } as never);
      const started = fake.notificationHandlers.get("mcpServer/startupStatus/updated");
      assert.isDefined(started);
      yield* Effect.ignore(
        started!({ name: "sneaky", status: "starting", threadId: "t" } as never),
      );
      const error = yield* client
        .request("turn/start", { threadId: "t", input: [] } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_REFUSAL);
    }),
  );
});

describe("CodexAdapterV2 under the Family lockdown", () => {
  const modelSelection = { instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID, model: "gpt-5.4" };
  const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    runtimeMode: "approval-required",
    interactionMode: "default",
    cwd: "/workspace",
  });

  const openAndStartThread = (withLockdown: boolean) =>
    Effect.gen(function* () {
      const fake = newFake();
      const launches: Array<string> = [];
      const adapter = yield* CodexAdapterV2.makeCodexAdapterV2({
        instanceId: CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_CODEX_SETTINGS,
        environment: {},
        clientFactory: {
          open: (input) =>
            Effect.sync(() => {
              launches.push(input.settings.launchArgs);
              return fakeCodexClient(input.settings.launchArgs, fake);
            }),
        },
        crypto: yield* Crypto.Crypto,
        fileSystem: yield* FileSystem.FileSystem,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* makeReplayServerConfig("family-lockdown").pipe(Effect.orDie),
      });
      const open = adapter.openSession({
        threadId: ThreadId.make("thread-family-lockdown"),
        providerSessionId: ProviderSessionId.make("provider-session-family-lockdown"),
        modelSelection,
        runtimePolicy,
      });
      const runtime = yield* withLockdown
        ? open.pipe(Effect.provideService(SkycotFamilyLockdown.FamilyLockdownRef, lockdown))
        : open;
      yield* runtime.ensureThread({
        threadId: ThreadId.make("thread-family-lockdown"),
        modelSelection,
        runtimePolicy,
      });
      return {
        launchArgs: launches[0] ?? "",
        threadConfig: (sent(fake, "thread/start")[0] as { config: Record<string, unknown> }).config,
      };
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer),
      ),
    );

  it.effect("starts a Family session's Codex without plugins, apps, MCP servers or notify", () =>
    Effect.gen(function* () {
      const { launchArgs, threadConfig } = yield* openAndStartThread(true);
      assert.include(launchArgs, "-c features.plugins=false");
      assert.include(launchArgs, "-c notify=[]");
      assert.deepEqual(threadConfig.mcp_servers, {
        node_repl: { enabled: false },
        "computer-use": { enabled: false },
        "dot.name": { enabled: false },
      });
      assert.strictEqual(threadConfig["features.apps"], false);
      assert.deepEqual(threadConfig.notify, []);
    }),
  );

  it.effect("changes nothing while the profile is off", () =>
    Effect.gen(function* () {
      const { launchArgs, threadConfig } = yield* openAndStartThread(false);
      assert.strictEqual(launchArgs, DEFAULT_CODEX_SETTINGS.launchArgs);
      assert.deepEqual(threadConfig, { ...CodexAdapterV2.CODEX_THREAD_CONFIG });
    }),
  );
});
