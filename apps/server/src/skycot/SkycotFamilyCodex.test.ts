// @effect-diagnostics-next-line nodeBuiltinImport:off -- the test reads the adapter's source.
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
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
import * as SkycotFamilySandbox from "./SkycotFamilySandbox.ts";

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

/** Where things are on the child's Mac, for the profile SKYCOT generates. */
const PLACES: SkycotFamilyCodex.FamilyCodexPlaces = {
  home: "/Users/kid",
  engineHome: "/Users/kid/.skycot",
  stateDir: "/Users/kid/.skycot/userdata",
  tmpDir: "/private/tmp/skycot-501/abc123",
  pathEnv: "/Users/kid/.nvm/versions/node/v24/bin:/opt/homebrew/bin:/usr/bin:/bin",
  platform: "darwin",
  cwd: "/workspace",
  uid: 501,
};

/**
 * The glob dialect the profile is written in (Codex's, checked live with codex-cli 0.160.1):
 * names compared without regard to case, `*` and `[!…]` never cross a `/`, `**` does, a class
 * is read as a regular-expression class (`.-/` a range), a trailing `/**` is everything below,
 * `[x]` a literal x.
 */
function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (glob.startsWith("/**", index) && index + 3 === glob.length) {
      out += "(/.*)?";
      break;
    }
    if (glob.startsWith("**", index)) {
      out += ".*";
      index += 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else if (char === "[") {
      const close = glob.indexOf("]", index + 2);
      const body = glob.slice(index + 1, close);
      out += body.startsWith("!")
        ? `[^${body.slice(1)}]`
        : `[${body.replace(/[\\\]^-]/g, "\\$&")}]`;
      index = close;
    } else out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`, "iu");
}

/** A thread answer as Codex 0.160 sends it (recorded, trimmed to what the schema needs). */
const threadAnswer = (id: string, activePermissionProfile: unknown) => ({
  thread: {
    id,
    sessionId: id,
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    projectId: null,
    modelProvider: "openai",
    model: "gpt-5.4",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/workspace",
    cliVersion: "0.160.1",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  },
  model: "gpt-5.4",
  modelProvider: "openai",
  serviceTier: null,
  cwd: "/workspace",
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
  activePermissionProfile,
  reasoningEffort: null,
});
const TURN_ANSWER = {
  turn: {
    id: "turn-1",
    items: [],
    status: "inProgress",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  },
};

interface FakeCodex {
  readonly requests: Array<{ readonly method: string; readonly params: unknown }>;
  readonly notificationHandlers: Map<
    string,
    (payload: never) => Effect.Effect<void, { readonly message: string }>
  >;
  readonly serverRequestHandlers: Map<string, (payload: unknown) => Effect.Effect<unknown>>;
}

/**
 * A pretend Codex app-server that behaves like the real one: Codex's switches show up in its
 * own `config/read`, and with plugins and apps off it lists none.
 */
/** A `-c` value SKYCOT wrote (`tomlInline`: JSON strings with `=`) read back, as Codex would. */
const fromTomlInline = (text: string): unknown =>
  JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")=/g, "$1:"));

/** A profile as Codex 0.160.1's `config/read` reports it: "none" as "deny", unknown fields null. */
const asCodexReportsIt = (profile: unknown): unknown => {
  const record = profile as { filesystem: Record<string, string>; network: object };
  return {
    ...record,
    extends: null,
    workspace_roots: null,
    filesystem: {
      glob_scan_max_depth: null,
      ...Object.fromEntries(
        Object.entries(record.filesystem).map(([key, value]) => [
          key,
          value === "none" ? "deny" : value,
        ]),
      ),
    },
    network: { ...record.network, proxy_url: null, mode: null },
  };
};

function fakeCodexClient(
  launchArgs: string,
  fake: FakeCodex,
  overrides: {
    readonly configRead?: unknown;
    readonly ignoresProfiles?: boolean;
    /** What another config layer (a grown-up's or project's config.toml) merges in. */
    readonly mergedPermissions?: Record<string, unknown>;
  } = {},
): CodexClient.CodexAppServerClient["Service"] {
  const locked = launchArgs.includes("features.plugins=false");
  const argv = tokenizeCliArgs(launchArgs);
  const values = argv.filter((_, index) => argv[index - 1] === "-c");
  const defaultId = values
    .find((value) => value.startsWith("default_permissions="))
    ?.slice("default_permissions=".length);
  const baseId = defaultId === undefined ? undefined : (JSON.parse(defaultId) as string);
  const launchedPermissions = Object.fromEntries(
    values
      .filter((value) => value.startsWith("permissions."))
      .map((value) => {
        const at = value.indexOf("=");
        return [
          value.slice("permissions.".length, at),
          asCodexReportsIt(fromTomlInline(value.slice(at + 1))),
        ];
      }),
  );
  const permissions = { ...launchedPermissions, ...overrides.mergedPermissions };
  // Codex reports the profile a thread asked for when it defines it (an older Codex: none).
  const activeProfile = (params: unknown) => {
    if (overrides.ignoresProfiles === true) return null;
    const record = params as { permissions?: unknown; config?: Record<string, unknown> };
    const id = record?.permissions ?? record?.config?.default_permissions;
    return typeof id === "string" && record?.config?.[`permissions.${id}`] !== undefined
      ? { id, extends: null }
      : baseId !== undefined
        ? { id: baseId, extends: null }
        : { id: ":workspace", extends: null };
  };
  const answer = (method: string, params: unknown): unknown => {
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
                    ...(baseId === undefined ? {} : { default_permissions: baseId }),
                    ...(Object.keys(permissions).length === 0 ? {} : { permissions }),
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
      case "thread/fork":
        return threadAnswer("native-family", activeProfile(params));
      case "turn/start":
        return TURN_ANSWER;
      default:
        return {};
    }
  };
  const request = (method: string, params?: unknown) =>
    Effect.sync(() => {
      fake.requests.push({ method, params });
      return answer(method, params);
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
    handleServerRequest: (method, handler) =>
      Effect.sync(() => {
        fake.serverRequestHandlers.set(method, handler as never);
      }),
    handleServerNotification: (method, handler) =>
      Effect.sync(() => {
        fake.notificationHandlers.set(method, handler as never);
      }),
    handleUnknownServerRequest: () => Effect.void,
    handleUnknownServerNotification: () => Effect.void,
  };
}

const newFake = (): FakeCodex => ({
  requests: [],
  notificationHandlers: new Map(),
  serverRequestHandlers: new Map(),
});
const sent = (fake: FakeCodex, method: string) =>
  fake.requests.filter((request) => request.method === method).map((request) => request.params);

describe("SkycotFamilyCodex.lockLaunch", () => {
  it("leaves the launch alone while the profile is off", () => {
    const input = { settings: { launchArgs: "--foo" }, environment: { A: "1" } };
    assert.strictEqual(SkycotFamilyCodex.lockLaunch(null, input), input);
  });

  it("appends Codex's own switches after the instance's launch arguments", () => {
    const locked = SkycotFamilyCodex.lockLaunch(
      lockdown,
      {
        settings: { launchArgs: "--from-settings" },
        environment: { T3CODE_CODEX_LAUNCH_ARGS: "-c model=gpt-5.4" },
      },
      PLACES,
    );
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
      "-c features.shell_snapshot=false",
    ]) {
      assert.include(args, expected);
    }
    assert.strictEqual(locked.environment.T3CODE_CODEX_LAUNCH_ARGS, args);
  });

  it("starts the process with the base profile as its default, quoted as one argument each", () => {
    const locked = SkycotFamilyCodex.lockLaunch(
      lockdown,
      { settings: { launchArgs: "" }, environment: {} },
      { ...PLACES, home: "/Users/o'brien" },
    );
    const argv = tokenizeCliArgs(locked.settings.launchArgs);
    const values = argv.filter((_, index) => argv[index - 1] === "-c");
    assert.include(values, `default_permissions="${SkycotFamilyCodex.FAMILY_CODEX_BASE_PROFILE}"`);
    const profile = values.find((value) =>
      value.startsWith(`permissions.${SkycotFamilyCodex.FAMILY_CODEX_BASE_PROFILE}=`),
    );
    assert.isDefined(profile);
    // The home with a quote in its name survives the launch string intact, and is unreadable.
    assert.include(profile!, `"/Users/o'brien"="none"`);
    assert.include(profile!, `":root"="read"`);
    assert.include(profile!, `"network"={"enabled"=false}`);
    assert.notInclude(profile!, `"write"`);
    const env = values.find((value) => value.startsWith("shell_environment_policy="));
    assert.include(env!, `"include_only"=[`);
  });
});

describe("SkycotFamilyCodex containment profile", () => {
  const filesystem = (cwd: string) =>
    SkycotFamilySandbox.familyFilesystem(
      { ...PLACES, cwd },
      {
        realpath: (path) => path,
        exists: (path) => path === "/Users/kid/.nvm",
      },
    );

  it("turns SkycotFamilySandbox's rules into a Codex filesystem table, most exact path last", () => {
    const table = SkycotFamilyCodex.familyCodexFilesystem(filesystem("/Users/kid/SKYCOT/app"));
    assert.strictEqual(table[":root"], "read");
    // Closed as a whole: nothing needed is inside.
    for (const denied of [
      "/Volumes",
      "/private/var/folders",
      "/private/var/tmp",
      "/Users/kid/.skycot",
      "/Users/kid/.codex",
      "/Users/kid/.ssh",
      "/private/tmp/claude-501",
    ]) {
      assert.strictEqual(table[denied], "none", denied);
    }
    assert.strictEqual(table["/Users/kid/SKYCOT/app"], "write");
    assert.strictEqual(table["/private/tmp/skycot-501/abc123"], "write");
    // Its .git keeps SKYCOT's versions: readable, never writable.
    assert.strictEqual(table["/Users/kid/SKYCOT/app/.git"], "read");
    // Toolchains come back for reading only.
    assert.strictEqual(table["/Users/kid/.nvm"], "read");
    // Never-writable places that were unreadable stay unreadable.
    assert.strictEqual(table["/Users/kid/.skycot/userdata"], "none");
  });

  it("keeps the folders above the project open for looking up, and everything else in them shut", () => {
    const table = SkycotFamilyCodex.familyCodexFilesystem(filesystem("/Users/kid/SKYCOT/app"));
    // Node looks up /Users, /Users/kid and /Users/kid/SKYCOT: they are not closed as a whole.
    for (const folder of ["/Users", "/Users/kid", "/Users/kid/SKYCOT", "/private/tmp"]) {
      assert.isUndefined(table[folder], folder);
    }
    const globs = Object.keys(table).filter((key) => /[[*]/.test(key));
    for (const glob of globs) assert.strictEqual(table[glob], "none", glob);
    const closedFolders = Object.keys(table).filter(
      (key) => !globs.includes(key) && table[key] === "none",
    );
    const matches = (path: string) =>
      globs.some((glob) => globToRegExp(glob).test(path)) ||
      closedFolders.some((folder) => SkycotFamilySandbox.isWithin(folder, path));
    // Everything else in those folders, now or later, matches a closing glob.
    for (const closed of [
      "/Users/parent",
      "/Users/parent/Documents/taxes.pdf",
      "/Users/kid/Documents/diary.txt",
      "/Users/kid/.zsh_history",
      "/Users/kid/S",
      "/Users/kid/SKYCO",
      "/Users/kid/SKYCOTS/x",
      "/Users/kid/SKYCOT/brother-app/notes.txt",
      "/Users/kid/SKYCOT/ap",
      "/Users/kid/SKYCOT/app2/secret",
      "/Users/kid/a-file-saved-tomorrow.txt",
      "/private/tmp/other-program.log",
      "/private/tmp/skycot-501/another-conversation/x",
    ]) {
      assert.isTrue(matches(closed), closed);
    }
    // Never "." or "..": Codex would read those as the folder itself.
    for (const key of Object.keys(table)) {
      assert.notMatch(key, /\/\.\.?(\/|$)/, key);
    }
    // The way down and what is needed never matches one.
    for (const open of [
      "/Users/kid",
      "/Users/kid/SKYCOT",
      "/Users/kid/SKYCOT/app",
      "/Users/kid/SKYCOT/app/src/index.js",
      "/Users/kid/.nvm/versions/node/v24/bin/node",
      "/private/tmp/skycot-501/abc123/scratch",
    ]) {
      assert.isFalse(matches(open), open);
    }
  });

  it("keeps SKYCOT's own state shut when the project is a private copy inside it", () => {
    const table = SkycotFamilyCodex.familyCodexFilesystem(
      filesystem("/Users/kid/.skycot/worktrees/kid-app/abc"),
    );
    assert.isUndefined(table["/Users/kid/.skycot"]);
    assert.strictEqual(table["/Users/kid/.skycot/worktrees/kid-app/abc"], "write");
    assert.strictEqual(table["/Users/kid/.skycot/userdata"], "none");
    const globs = Object.keys(table).filter((key) => /[[*]/.test(key));
    const closedFolders = Object.keys(table).filter(
      (key) => !globs.includes(key) && table[key] === "none",
    );
    const closed = (path: string) =>
      closedFolders.some((folder) => SkycotFamilySandbox.isWithin(folder, path)) ||
      globs.some((glob) => globToRegExp(glob).test(path));
    for (const path of [
      "/Users/kid/.skycot/userdata/skycot-family.json",
      "/Users/kid/.skycot/origin-secret.txt",
      "/Users/kid/.skycot/worktrees/brother-app/x",
      "/Users/kid/.skycot/worktrees/kid-app/other-copy/x",
    ]) {
      assert.isTrue(closed(path), path);
    }
    assert.isFalse(closed("/Users/kid/.skycot/worktrees/kid-app/abc/index.html"));
  });

  it("closes every other name, with awkward characters written literally", () => {
    const globs = SkycotFamilyCodex.everyOtherName(
      "/Users/kid/My {Games}",
      new Set(["a-b!", "a*", "Sky^.x"]),
    );
    const regexes = globs.map(globToRegExp);
    const matches = (name: string) =>
      regexes.some((regex) => regex.test(`/Users/kid/My {Games}/${name}`));
    // Kept, in any case (the Mac's disk does not tell SKYCOT from skycot).
    for (const name of ["a-b!", "a*", "Sky^.x", "A-B!", "sky^.X"]) {
      assert.isFalse(matches(name), name);
    }
    for (const name of ["a", "a-", "a-b", "a-b!x", "ab", "a*x", "b", ".hidden", "sky", "sky^"]) {
      assert.isTrue(matches(name), name);
    }
    assert.throws(() => SkycotFamilyCodex.everyOtherName("/Users/kid", new Set(["odd]name"])));
    // No checked way to write "neither - nor ." in one class: refused, never guessed.
    assert.throws(() => SkycotFamilyCodex.everyOtherName("/Users/kid", new Set(["-x", ".y"])));
  });

  it("never writes an accented or other non-ASCII name in a glob: refused instead (B1)", () => {
    // macOS's sandbox folds accents its own way: with `élan` kept, `eve/` and `ève/` were readable.
    for (const keep of ["élan", "ève", "café", "naïve", "日本", "élan", "tab\tname"]) {
      assert.throws(
        () => SkycotFamilyCodex.everyOtherName("/Users/kid/Projects", new Set([keep])),
        SkycotFamilyCodex.FamilyCodexPathError,
        undefined,
        keep,
      );
    }
    // An accented folder on the way down is refused too.
    assert.throws(
      () => SkycotFamilyCodex.everyOtherName("/Users/kid/Développement", new Set(["x"])),
      SkycotFamilyCodex.FamilyCodexPathError,
    );
    // Only plain ASCII ever reaches a pattern.
    const globs = SkycotFamilyCodex.everyOtherName(
      "/Users/kid/Projects",
      new Set(["elan", "My Game_2"]),
    );
    for (const glob of globs) assert.match(glob, /^[\x20-\x7E]+$/, glob);
  });

  it("refuses the whole profile for a project with an accent in it or above it (B1)", () => {
    for (const cwd of ["/Users/kid/Projects/élan", "/Users/kid/Développement/x"]) {
      assert.throws(
        () => SkycotFamilyCodex.familyCodexThreadContainment(PLACES, cwd),
        SkycotFamilyCodex.FamilyCodexPathError,
        undefined,
        cwd,
      );
    }
    // A plain-ASCII project next to accented siblings is fine: their names are never written.
    const config = SkycotFamilyCodex.familyCodexThreadContainment(
      PLACES,
      "/Users/kid/Projects/elan",
    );
    const profile = config[`permissions.${SkycotFamilyCodex.FAMILY_CODEX_PROFILE}`] as {
      filesystem: Record<string, string>;
    };
    assert.strictEqual(profile.filesystem["/Users/kid/Projects/elan"], "write");
    const globs = Object.keys(profile.filesystem).filter((key) => /[[*]/.test(key));
    const closed = (path: string) => globs.some((glob) => globToRegExp(glob).test(path));
    for (const sibling of ["eve/s.txt", "Eve2/s.txt", "elan2/s.txt", "elan-old/x"]) {
      assert.isTrue(closed(`/Users/kid/Projects/${sibling}`), sibling);
    }
    assert.isFalse(closed("/Users/kid/Projects/elan/index.html"));
  });

  it("gives a thread its project's profile, no internet, and a filtered environment", () => {
    const config = SkycotFamilyCodex.familyCodexThreadContainment(PLACES, "/workspace");
    const profile = config[`permissions.${SkycotFamilyCodex.FAMILY_CODEX_PROFILE}`] as {
      filesystem: Record<string, string>;
      network: unknown;
    };
    assert.strictEqual(config.default_permissions, SkycotFamilyCodex.FAMILY_CODEX_PROFILE);
    assert.strictEqual(profile.filesystem["/workspace"], "write");
    assert.deepEqual(profile.network, { enabled: false });
    const env = config.shell_environment_policy as {
      include_only: Array<string>;
      set: Record<string, string>;
    };
    assert.include(env.include_only, "PATH");
    assert.include(env.include_only, "LC_*");
    assert.notInclude(env.include_only, "OPENAI_API_KEY");
    assert.strictEqual(env.set.TMPDIR, PLACES.tmpDir);
    assert.strictEqual(env.set.GIT_CONFIG_GLOBAL, "/dev/null");
  });

  it("keeps a Codex home outside the usual place unreadable too", () => {
    const config = SkycotFamilyCodex.familyCodexThreadContainment(
      { ...PLACES, codexHome: "/opt/codex-home" },
      "/workspace",
    );
    const profile = config[`permissions.${SkycotFamilyCodex.FAMILY_CODEX_PROFILE}`] as {
      filesystem: Record<string, string>;
    };
    assert.strictEqual(profile.filesystem["/opt/codex-home"], "none");
  });

  it("writes TOML inline values Codex's -c parses", () => {
    assert.strictEqual(
      SkycotFamilyCodex.tomlInline({ a: ["x", true], "b.c": { d: 1 } }),
      `{"a"=["x",true],"b.c"={"d"=1}}`,
    );
  });

  it("switches every tool off for text generation", () => {
    const args = SkycotFamilyCodex.lockExecArgs(lockdown).join(" ");
    for (const name of [
      "shell_tool",
      "unified_exec",
      "view_image",
      "multi_agent",
      "multi_agent_v2",
      "image_generation",
    ]) {
      assert.include(args, `-c features.${name}=false`);
    }
    assert.include(args, `-c web_search="disabled"`);
    assert.deepEqual(SkycotFamilyCodex.lockExecArgs(null), []);
  });

  it("starts a child's Codex with no way to ask for more, no image viewer and no helpers (S2, S4)", () => {
    const args = SkycotFamilyCodex.FAMILY_CODEX_LAUNCH_ARGS.join(" ");
    for (const name of [
      "request_permissions_tool",
      "exec_permission_approvals",
      "view_image",
      "multi_agent",
      "multi_agent_v2",
    ]) {
      assert.include(args, `-c features.${name}=false`);
      // And the process must report each of them off before a thread starts.
      assert.include(SkycotFamilyCodex.FAMILY_CODEX_REQUIRED_OFF as ReadonlyArray<string>, name);
    }
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
  const lockedArgs = SkycotFamilyCodex.lockLaunch(
    lockdown,
    { settings: { launchArgs: "" }, environment: {} },
    PLACES,
  ).settings.launchArgs;

  it.effect("is the same client while the profile is off", () =>
    Effect.sync(() => {
      const client = fakeCodexClient("", newFake());
      assert.strictEqual(SkycotFamilyCodex.lockClient(null, client), client);
    }),
  );

  it.effect("starts and resumes threads with every MCP server and skill off", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
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
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient("", fake), PLACES);
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
        PLACES,
      );
      const error = yield* client.request("thread/start", {} as never).pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect("never writes the parent's config or calls MCP tools", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
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
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      yield* client.request("thread/start", { cwd: "/workspace" } as never);
      yield* client.request("turn/start", { threadId: "native-family", input: [] } as never);
      const started = fake.notificationHandlers.get("mcpServer/startupStatus/updated");
      assert.isDefined(started);
      yield* Effect.ignore(
        started!({ name: "sneaky", status: "starting", threadId: "native-family" } as never),
      );
      const error = yield* client
        .request("turn/start", { threadId: "native-family", input: [] } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_REFUSAL);
    }),
  );
});

describe("SkycotFamilyCodex.lockClient containment", () => {
  const lockedArgs = SkycotFamilyCodex.lockLaunch(
    lockdown,
    { settings: { launchArgs: "" }, environment: {} },
    PLACES,
  ).settings.launchArgs;
  const turn = (threadId: string) => ({
    threadId,
    input: [],
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
  });

  it.effect("starts every thread with the project's profile and checks Codex took it", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      const started = yield* client.request("thread/start", {
        cwd: "/workspace",
        config: { "permissions.mine": { filesystem: { ":root": "write" } }, sandbox_mode: "x" },
      } as never);
      assert.strictEqual(started.thread.id, "native-family");
      const params = sent(fake, "thread/start")[0] as {
        permissions: string;
        config: Record<string, unknown>;
      };
      assert.strictEqual(params.permissions, SkycotFamilyCodex.FAMILY_CODEX_PROFILE);
      assert.strictEqual(params.config.default_permissions, SkycotFamilyCodex.FAMILY_CODEX_PROFILE);
      assert.isUndefined(params.config["permissions.mine"]);
      assert.isUndefined(params.config.sandbox_mode);
      const profile = params.config[`permissions.${SkycotFamilyCodex.FAMILY_CODEX_PROFILE}`] as {
        filesystem: Record<string, string>;
      };
      assert.strictEqual(profile.filesystem["/workspace"], "write");
      assert.strictEqual(profile.filesystem["/Users/kid/.ssh"], "none");
      assert.strictEqual(profile.filesystem["/Volumes"], "none");
    }),
  );

  it.effect("sends turns with the profile instead of the legacy sandbox policy", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      yield* client.raw.request("thread/resume", { threadId: "native-family", cwd: "/workspace" });
      const answer = yield* client.request("turn/start", turn("native-family") as never);
      assert.strictEqual(answer.turn.id, "turn-1");
      const params = sent(fake, "turn/start")[0] as Record<string, unknown>;
      assert.strictEqual(params.permissions, SkycotFamilyCodex.FAMILY_CODEX_PROFILE);
      assert.isUndefined(params.sandboxPolicy);
      assert.strictEqual(params.approvalPolicy, "untrusted");
    }),
  );

  it.effect("refuses a turn on a thread Codex never confirmed", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      const error = yield* client.request("turn/start", turn("other") as never).pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "turn/start"), 0);
    }),
  );

  it.effect("refuses a thread when Codex does not report the Family profile (fail closed)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake, { ignoresProfiles: true }),
        PLACES,
      );
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      const turnError = yield* client
        .request("turn/start", turn("native-family") as never)
        .pipe(Effect.flip);
      assert.strictEqual(turnError.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "turn/start"), 0);
    }),
  );

  it.effect("refuses when the process did not start with the base profile", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(SkycotFamilyCodex.FAMILY_CODEX_LAUNCH_ARGS.join(" "), fake),
        PLACES,
      );
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect.each([
    ["no temporary folder", { ...PLACES, tmpDir: undefined }],
    ["an unknown platform", { ...PLACES, platform: "win32" as const }],
    ["no places at all", undefined],
  ] as const)("refuses every thread with %s", ([, places]) =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        places,
      );
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect("refuses when another config layer changed the base profile (S1)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const base = SkycotFamilyCodex.familyCodexBaseContainment(PLACES)[
        `permissions.${SkycotFamilyCodex.FAMILY_CODEX_BASE_PROFILE}`
      ] as { filesystem: Record<string, string> };
      // The grown-up's config.toml merged one more entry into SKYCOT's profile.
      const merged = asCodexReportsIt({
        ...base,
        filesystem: { ...base.filesystem, "/workspace/.git/hooks": "write" },
      });
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake, {
          mergedPermissions: { [SkycotFamilyCodex.FAMILY_CODEX_BASE_PROFILE]: merged },
        }),
        PLACES,
      );
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it.effect("refuses when another config layer names the thread's profile (S1)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake, {
          mergedPermissions: {
            [SkycotFamilyCodex.FAMILY_CODEX_PROFILE]: {
              filesystem: { "/workspace/.git": "write" },
            },
          },
        }),
        PLACES,
      );
      const error = yield* client
        .request("thread/start", { cwd: "/workspace" } as never)
        .pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "thread/start"), 0);
    }),
  );

  it("compares profiles the way Codex reports them, and nothing looser (S1)", () => {
    const sentProfile = { description: "d", filesystem: { ":root": "read", "/a": "none" } };
    const id = "p";
    const read = (profile: unknown) => ({ config: { permissions: { [id]: profile } } });
    assert.deepEqual(
      SkycotFamilyCodex.familyProfileProblems(read(asCodexReportsIt(sentProfile)), {
        [id]: sentProfile,
      }),
      [],
    );
    for (const changed of [
      { ...sentProfile, extends: ":workspace" },
      { ...sentProfile, filesystem: { ...sentProfile.filesystem, "/b": "write" } },
      { ...sentProfile, filesystem: { ":root": "read" } },
      undefined,
    ]) {
      assert.lengthOf(
        SkycotFamilyCodex.familyProfileProblems(read(changed), { [id]: sentProfile }),
        1,
        JSON.stringify(changed),
      );
    }
    assert.deepEqual(SkycotFamilyCodex.familyProfileProblems(null, {}), ["config unreadable"]);
  });

  it.effect("gives every session its own random profile ids (S1)", () =>
    Effect.gen(function* () {
      const environment = {};
      const one = yield* SkycotFamilyCodex.sessionPlaces({
        engineHome: "/e",
        stateDir: "/e/userdata",
        environment,
        codexHomePath: undefined,
        cwd: "/workspace",
      });
      const two = yield* SkycotFamilyCodex.sessionPlaces({
        engineHome: "/e",
        stateDir: "/e/userdata",
        environment,
        codexHomePath: undefined,
        cwd: "/workspace",
      });
      assert.match(one.profileId ?? "", /^skycot_family_[0-9a-f]{32}$/);
      assert.notStrictEqual(one.profileId, two.profileId);
      assert.deepEqual(SkycotFamilyCodex.familyProfileIds(one), {
        thread: one.profileId!,
        base: `${one.profileId!}_base`,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a thread with no folder to work in", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(lockdown, fakeCodexClient(lockedArgs, fake), {
        ...PLACES,
        cwd: undefined,
      });
      const error = yield* client.request("thread/start", {} as never).pipe(Effect.flip);
      assert.strictEqual(error.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
    }),
  );

  it.effect("answers every permission request with nothing granted, before any card (S2)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      let adapterAsked = 0;
      yield* client.handleServerRequest("item/permissions/requestApproval", () => {
        adapterAsked += 1;
        return Effect.succeed({ permissions: { network: { enabled: true } }, scope: "session" });
      });
      const handler = fake.serverRequestHandlers.get("item/permissions/requestApproval")!;
      const answer = yield* handler({
        threadId: "native-family",
        turnId: "turn-1",
        itemId: "i",
        cwd: "/workspace",
        reason: "I only need to read src/index.js",
        permissions: { fileSystem: { read: ["/Users/kid/.ssh"] } },
      });
      assert.deepEqual(answer, { permissions: {}, scope: "turn" });
      assert.strictEqual(adapterAsked, 0);
    }),
  );

  it.effect("declines a command approval that asks for extra permissions or internet (S2)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      const seen: Array<unknown> = [];
      yield* client.handleServerRequest("item/commandExecution/requestApproval", (payload) => {
        seen.push(payload);
        return Effect.succeed({ decision: "accept" as const });
      });
      const handler = fake.serverRequestHandlers.get("item/commandExecution/requestApproval")!;
      const base = { threadId: "native-family", turnId: "t", itemId: "i", command: "ls" };
      for (const extra of [
        { additionalPermissions: { fileSystem: { read: ["/Users/kid"] } } },
        { networkApprovalContext: { host: "example.com", protocol: "https" } },
        { proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }] },
      ]) {
        const answer = yield* handler({ ...base, ...extra });
        assert.deepEqual(answer, { decision: "decline" }, JSON.stringify(extra));
      }
      assert.lengthOf(seen, 0);
      // An ordinary command approval still goes to the adapter (and SKYCOT's rules).
      const plain = yield* handler({ ...base, proposedNetworkPolicyAmendments: [] });
      assert.deepEqual(plain, { decision: "accept" });
      assert.lengthOf(seen, 1);
    }),
  );

  it.effect("leaves server requests alone while the profile is off (grown-ups unchanged)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(null, fakeCodexClient("", fake));
      yield* client.handleServerRequest("item/permissions/requestApproval", () =>
        Effect.succeed({ permissions: { fileSystem: { read: ["/x"] } }, scope: "turn" as const }),
      );
      const answer = yield* fake.serverRequestHandlers.get("item/permissions/requestApproval")!({});
      assert.deepEqual(answer, { permissions: { fileSystem: { read: ["/x"] } }, scope: "turn" });
    }),
  );

  it.effect("refuses every method that is not on the allow list (S3)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      for (const method of [
        "fuzzyFileSearch",
        "fuzzyFileSearch/sessionStart",
        "thread/queue/add",
        "thread/queue/start",
        "environment/add",
        "thread/realtime/start",
        "thread/approveGuardianDeniedAction",
        "skills/extraRoots/set",
        "plugin/read",
        "plugin/uninstall",
        "marketplace/remove",
        "memory/reset",
        "rollout/compress",
        "thread/delete",
        "thread/archive",
        "account/logout",
        "remoteControl/enable",
        "feedback/upload",
        "a/method/codex/adds/tomorrow",
      ]) {
        const result = yield* Effect.result(client.raw.request(method, {}));
        assert.strictEqual(
          result._tag === "Failure" ? result.failure.message : "sent",
          SkycotFamilyCodex.FAMILY_CODEX_REFUSAL,
          method,
        );
      }
      assert.lengthOf(fake.requests, 0);
    }),
  );

  it("allows every method SKYCOT's adapter sends, except the ones refused on purpose (S3)", () => {
    const sources = [
      "../orchestration-v2/Adapters/CodexAdapterV2.ts",
      "../provider/CodexThreadRevert.ts",
    ].map((file) => NodeFS.readFileSync(new URL(file, import.meta.url), "utf8"));
    const methods = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/\.request\(\s*"([^"]+)"/g)].map((match) => match[1]!),
      ),
    );
    assert.isAbove(methods.size, 15);
    for (const method of methods) {
      assert.isTrue(
        SkycotFamilyCodex.FAMILY_CODEX_ALLOWED_METHODS.has(method) ||
          SkycotFamilyCodex.FAMILY_CODEX_REFUSED_ADAPTER_METHODS.has(method),
        `${method} is sent by the adapter: allow it or refuse it on purpose`,
      );
    }
    for (const method of SkycotFamilyCodex.FAMILY_CODEX_ALLOWED_METHODS) {
      assert.isTrue(methods.has(method), `${method} is allowed but the adapter never sends it`);
    }
  });

  it.effect("holds compaction and goals to the same rules as a turn (M2)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      // On a thread Codex never confirmed: refused.
      for (const [method, params] of [
        ["thread/compact/start", { threadId: "other" }],
        ["thread/goal/set", { threadId: "other", objective: "x", status: "active" }],
      ] as const) {
        const result = yield* Effect.result(client.raw.request(method, params));
        assert.strictEqual(
          result._tag === "Failure" ? result.failure.message : "sent",
          SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL,
          method,
        );
      }
      // Pausing a goal always goes through.
      yield* client.raw.request("thread/goal/set", { threadId: "other", status: "paused" });
      yield* client.request("thread/start", { cwd: "/workspace" } as never);
      yield* client.raw.request("thread/compact/start", { threadId: "native-family" });
      const started = fake.notificationHandlers.get("mcpServer/startupStatus/updated")!;
      yield* Effect.ignore(
        started({ name: "sneaky", status: "starting", threadId: "native-family" } as never),
      );
      for (const method of ["thread/compact/start", "thread/goal/set", "thread/resume"]) {
        const result = yield* Effect.result(
          client.raw.request(method, { threadId: "native-family", cwd: "/workspace" }),
        );
        assert.strictEqual(
          result._tag === "Failure" ? result.failure.message : "sent",
          SkycotFamilyCodex.FAMILY_CODEX_REFUSAL,
          method,
        );
      }
      assert.lengthOf(sent(fake, "thread/compact/start"), 1);
    }),
  );

  it.effect("forgets a thread whose resume Codex does not confirm (M3)", () =>
    Effect.gen(function* () {
      const fake = newFake();
      let ignore = false;
      const inner = fakeCodexClient(lockedArgs, fake);
      const flaky: CodexClient.CodexAppServerClient["Service"] = {
        ...inner,
        raw: {
          ...inner.raw,
          request: (method: string, params?: unknown) =>
            inner.raw
              .request(method, params)
              .pipe(
                Effect.map((answer) =>
                  ignore && method === "thread/resume"
                    ? { ...(answer as object), activePermissionProfile: null }
                    : answer,
                ),
              ),
        },
      };
      const client = SkycotFamilyCodex.lockClient(lockdown, flaky, PLACES);
      yield* client.raw.request("thread/resume", { threadId: "native-family", cwd: "/workspace" });
      yield* client.request("turn/start", turn("native-family") as never);
      ignore = true;
      const resumed = yield* Effect.result(
        client.raw.request("thread/resume", { threadId: "native-family", cwd: "/workspace" }),
      );
      assert.strictEqual(
        resumed._tag === "Failure" ? resumed.failure.message : "resumed",
        SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL,
      );
      const turnError = yield* client
        .request("turn/start", turn("native-family") as never)
        .pipe(Effect.flip);
      assert.strictEqual(turnError.message, SkycotFamilyCodex.FAMILY_CODEX_SANDBOX_REFUSAL);
      assert.lengthOf(sent(fake, "turn/start"), 1);
    }),
  );

  it.effect("never runs a command or touches a file outside a turn", () =>
    Effect.gen(function* () {
      const fake = newFake();
      const client = SkycotFamilyCodex.lockClient(
        lockdown,
        fakeCodexClient(lockedArgs, fake),
        PLACES,
      );
      for (const method of [
        "thread/shellCommand",
        "command/exec",
        "process/spawn",
        "fs/readFile",
        "fs/writeFile",
        "thread/settings/update",
      ]) {
        const result = yield* Effect.result(client.raw.request(method, {}));
        assert.strictEqual(
          result._tag === "Failure" ? result.failure.message : "sent",
          SkycotFamilyCodex.FAMILY_CODEX_REFUSAL,
          method,
        );
      }
      assert.lengthOf(fake.requests, 0);
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
      const threadParams = sent(fake, "thread/start")[0] as {
        config: Record<string, unknown>;
        permissions?: unknown;
      };
      return {
        launchArgs: launches[0] ?? "",
        threadConfig: threadParams.config,
        threadPermissions: threadParams.permissions,
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

  it.effect("contains a Family session's commands to the project", () =>
    Effect.gen(function* () {
      const { launchArgs, threadConfig, threadPermissions } = yield* openAndStartThread(true);
      // A random id for this session (S1): no other config layer can name it in advance.
      assert.match(String(threadPermissions), /^skycot_family_[0-9a-f]{32}$/);
      assert.include(launchArgs, `'default_permissions="${String(threadPermissions)}_base"'`);
      assert.strictEqual(threadConfig.default_permissions, threadPermissions);
      const profile = threadConfig[`permissions.${String(threadPermissions)}`] as {
        filesystem: Record<string, string>;
      };
      assert.strictEqual(profile.filesystem["/workspace"], "write");
      const env = threadConfig.shell_environment_policy as { set: Record<string, string> };
      // The session's own temporary folder, made for it and writable by its commands.
      assert.match(env.set.TMPDIR ?? "", /skycot-\d+\//);
      assert.strictEqual(profile.filesystem[env.set.TMPDIR!], "write");
    }),
  );

  it.effect("changes nothing while the profile is off", () =>
    Effect.gen(function* () {
      const { launchArgs, threadConfig, threadPermissions } = yield* openAndStartThread(false);
      assert.strictEqual(launchArgs, DEFAULT_CODEX_SETTINGS.launchArgs);
      assert.deepEqual(threadConfig, { ...CodexAdapterV2.CODEX_THREAD_CONFIG });
      assert.isUndefined(threadPermissions);
    }),
  );
});
