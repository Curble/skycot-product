// nondev-seam: skycot-policy-files
// Family lockdown for Codex (see SkycotFamilyLockdown.ts for when it applies).
//
// A Codex app-server reads the parent's ~/.codex/config.toml: plugins (computer use, browser,
// Chrome, documents...), apps and connectors, MCP servers, skills, hooks and the `notify`
// program it runs after every turn. While the Family profile is on, SKYCOT starts a separate
// Codex process for the child's conversation and switches all of it off, in three layers:
//
//   1. The process (`lockLaunch`): Codex's own wholesale switches go on its command line as
//      `-c` overrides, the strongest config layer, so neither the parent's file nor a project's
//      `.codex/config.toml` can turn them back on: plugins, apps, hooks, computer use, browser
//      use, remote plugins, plugin suggestions, memories, Codex's bundled skills, and `notify`
//      emptied. A plugin installed tomorrow is off too: no list of names is involved.
//   2. Every thread it starts, resumes or forks (`lockClient`): MCP servers have no wholesale
//      switch (`mcp_servers = {}` merges instead of replacing), so before each thread SKYCOT asks
//      this very process for its effective config at the thread's folder (`config/read`, which
//      includes project layers) and its skills (`skills/list`), and turns each one off by name
//      for that thread. Read fresh every time, so a server or skill added a minute ago is
//      included; the layer-1 switches are repeated per thread as well.
//   3. Proof, fail closed: before the first thread, the process must report the switches off
//      (`config/read`) and list no enabled plugin or app (`plugin/list`, `app/list`). If it
//      cannot, or any MCP server starts for a locked thread anyway, the thread or turn is
//      refused with a plain sentence instead of running with the parent's add-ons.
//
// Why not an isolated CODEX_HOME with only the sign-in: it would also miss nothing in the home,
// but Codex keeps the sign-in (auth.json or the system keychain, keyed by the home's path), the
// thread history and its databases there. A copied auth.json can sign the parent out when its
// refresh token rotates, keychain sign-ins would not be found at all, and a child's earlier
// conversations would no longer resume. Codex's own switches keep one home and lose nothing.
//
// Limits (FAMILY.md): Codex's built-in tools (shell, file edits, web search, image generation,
// sub-agents) stay; SKYCOT's command policy still asks before the risky ones. The parent's
// AGENTS.md instructions are still read (text, not tools).

import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import { resolveCodexLaunchArgs } from "../provider/codexLaunchArgs.ts";
import type { FamilyLockdown } from "./SkycotFamilyLockdown.ts";

/** Codex features a child's process runs without. Names Codex does not know are ignored by it. */
export const FAMILY_CODEX_FEATURES_OFF = [
  "plugins",
  "apps",
  "hooks",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "in_app_browser",
  "remote_plugin",
  "plugin_sharing",
  "recommended_plugins",
  "tool_suggest",
  "skill_mcp_dependency_install",
  "enable_mcp_apps",
  "memories",
] as const;

/** The switches the process must report off before a child's thread starts. */
export const FAMILY_CODEX_REQUIRED_OFF = [
  "plugins",
  "apps",
  "hooks",
  "computer_use",
  "browser_use",
] as const;

/** Config every Family process and thread carries (dotted keys, Codex's `-c` form). */
export const FAMILY_CODEX_CONFIG: Readonly<Record<string, Schema.Json>> = {
  ...Object.fromEntries(FAMILY_CODEX_FEATURES_OFF.map((name) => [`features.${name}`, false])),
  notify: [],
  "skills.bundled.enabled": false,
};

/** The same, as app-server launch arguments. Values are TOML without spaces, so no quoting. */
export const FAMILY_CODEX_LAUNCH_ARGS: ReadonlyArray<string> = Object.entries(
  FAMILY_CODEX_CONFIG,
).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]);

const T3CODE_CODEX_LAUNCH_ARGS_ENV = "T3CODE_CODEX_LAUNCH_ARGS";

/**
 * The launch settings for a Family session's Codex process. The instance's own launch
 * arguments stay first (the environment variable wins over settings upstream, so both carry
 * the result); ours come last, so they win. Unchanged when the profile was off.
 */
export function lockLaunch<S extends { readonly launchArgs: string }>(
  lockdown: FamilyLockdown | null,
  input: { readonly settings: S; readonly environment: NodeJS.ProcessEnv },
): { readonly settings: S; readonly environment: NodeJS.ProcessEnv } {
  if (lockdown === null) return input;
  const own = resolveCodexLaunchArgs(input.settings.launchArgs, input.environment);
  const launchArgs = [own, ...FAMILY_CODEX_LAUNCH_ARGS].filter((part) => part.length > 0).join(" ");
  return {
    settings: { ...input.settings, launchArgs },
    environment: { ...input.environment, [T3CODE_CODEX_LAUNCH_ARGS_ENV]: launchArgs },
  };
}

/**
 * The same switches for a one-shot `codex exec` (T3's text generation: titles, commit
 * messages): none while the profile was off.
 */
export function lockExecArgs(lockdown: FamilyLockdown | null): ReadonlyArray<string> {
  return lockdown === null ? [] : FAMILY_CODEX_LAUNCH_ARGS;
}

interface SkillEntry {
  readonly path: string;
  readonly scope: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** MCP server names in a `config/read` answer. */
export function mcpServerNames(configRead: unknown): ReadonlyArray<string> {
  const config = isRecord(configRead) ? configRead.config : undefined;
  const servers = isRecord(config) ? config.mcp_servers : undefined;
  return isRecord(servers) ? Object.keys(servers) : [];
}

/** Skills in a `skills/list` answer that are not Codex's own bundled ones. */
export function nonSystemSkills(skillsList: unknown): ReadonlyArray<SkillEntry> {
  const data = isRecord(skillsList) && Array.isArray(skillsList.data) ? skillsList.data : [];
  const skills: Array<SkillEntry> = [];
  for (const entry of data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      if (!isRecord(skill) || typeof skill.path !== "string") continue;
      const scope = typeof skill.scope === "string" ? skill.scope : "unknown";
      if (scope !== "system") skills.push({ path: skill.path, scope });
    }
  }
  return skills;
}

/**
 * Pure: a thread's `config` with the Family overrides. Any MCP server the caller named itself is
 * dropped (none is issued in Family, F18), every server the process knows is switched off, and
 * every skill that is not Codex's own is switched off.
 */
export function familyThreadConfig(
  base: Readonly<Record<string, Schema.Json>> | undefined,
  found: { readonly mcpServers: ReadonlyArray<string>; readonly skills: ReadonlyArray<SkillEntry> },
): Record<string, Schema.Json> {
  const kept = Object.fromEntries(
    Object.entries(base ?? {}).filter(
      ([key]) => key !== "mcp_servers" && !key.startsWith("mcp_servers."),
    ),
  );
  return {
    ...kept,
    ...FAMILY_CODEX_CONFIG,
    // Nested, not dotted: a server name may itself contain a dot.
    mcp_servers: Object.fromEntries(found.mcpServers.map((name) => [name, { enabled: false }])),
    "skills.config": found.skills.map((skill) => ({ path: skill.path, enabled: false })),
  };
}

/**
 * Pure: what is still on in a Family process, from its own answers. Empty means locked.
 */
export function familyProcessProblems(answers: {
  readonly configRead: unknown;
  readonly pluginList: unknown;
  readonly appList: unknown;
}): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const config = isRecord(answers.configRead) ? answers.configRead.config : undefined;
  const features = isRecord(config) && isRecord(config.features) ? config.features : {};
  for (const name of FAMILY_CODEX_REQUIRED_OFF) {
    if (features[name] !== false) problems.push(`feature ${name} is not off`);
  }
  const notify = isRecord(config) ? config.notify : undefined;
  if (Array.isArray(notify) ? notify.length > 0 : notify != null) {
    problems.push("notify is set");
  }
  const marketplaces =
    isRecord(answers.pluginList) && Array.isArray(answers.pluginList.marketplaces)
      ? answers.pluginList.marketplaces
      : null;
  if (marketplaces === null) problems.push("plugin list unreadable");
  for (const marketplace of marketplaces ?? []) {
    const plugins =
      isRecord(marketplace) && Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    for (const plugin of plugins) {
      if (isRecord(plugin) && plugin.enabled === true) {
        problems.push(`plugin ${String(plugin.id ?? plugin.name)} is enabled`);
      }
    }
  }
  const apps =
    isRecord(answers.appList) && Array.isArray(answers.appList.data) ? answers.appList.data : null;
  if (apps === null) problems.push("app list unreadable");
  for (const app of apps ?? []) {
    if (isRecord(app) && app.isEnabled === true) {
      problems.push(`app ${String(app.id ?? app.name)} is enabled`);
    }
  }
  return problems;
}

export const FAMILY_CODEX_REFUSAL =
  "The Family profile is on, and SKYCOT could not confirm that Codex's own add-ons on this computer (plugins, connectors, MCP servers and helper programs) are switched off, so it didn't start. Try again; if it keeps happening, a grown-up can choose Claude for this conversation or switch the Family profile off.";

const refusal = (method: string, detail: string) =>
  new CodexErrors.CodexAppServerRequestError({
    code: -32_099,
    errorMessage: FAMILY_CODEX_REFUSAL,
    method,
    data: { skycotFamilyLockdown: detail },
  });

const THREAD_METHODS = new Set(["thread/start", "thread/resume", "thread/fork"]);
const TURN_METHODS = new Set(["turn/start", "turn/steer"]);
/** Never sent for a child: writing the parent's Codex config, installing, or calling MCP tools. */
const BLOCKED_METHODS = new Set([
  "config/value/write",
  "config/batchWrite",
  "config/mcpServer/reload",
  "skills/config/write",
  "plugin/install",
  "marketplace/add",
  "marketplace/upgrade",
  "experimentalFeature/enablement/set",
  "externalAgentConfig/import",
  "mcpServer/oauth/login",
  "mcpServer/tool/call",
  "mcpServer/resource/read",
]);

type Client = CodexClient.CodexAppServerClient["Service"];
type RawRequest = (
  method: string,
  payload?: unknown,
) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>;

/**
 * The Codex client of a Family session (see the header, layers 2 and 3). The same client when
 * the profile was off when the session opened.
 */
export function lockClient(lockdown: FamilyLockdown | null, client: Client): Client {
  if (lockdown === null) return client;
  const rawRequest: RawRequest = client.raw.request;
  let verified = false;
  let tainted: string | null = null;

  const verifyProcess = Effect.gen(function* () {
    if (verified) return;
    const [configRead, pluginList, appList] = yield* Effect.all([
      rawRequest("config/read", {}),
      rawRequest("plugin/list", {}),
      rawRequest("app/list", {}),
    ]);
    const problems = familyProcessProblems({ configRead, pluginList, appList });
    if (problems.length > 0) {
      yield* Effect.logError("skycot-family.codex.process-not-locked", { problems });
      return yield* refusal("thread/start", problems.join("; "));
    }
    // Layer 3, after the fact: an MCP server starting for a locked thread means one was missed.
    yield* client.handleServerNotification("mcpServer/startupStatus/updated", (payload) =>
      Effect.gen(function* () {
        tainted = payload.name;
        yield* Effect.logError("skycot-family.codex.mcp-server-started", {
          name: payload.name,
          threadId: payload.threadId,
        });
      }),
    );
    verified = true;
    yield* Effect.logInfo("skycot-family.codex.process-locked");
  });

  const lockThreadParams = Effect.fn("SkycotFamilyCodex.lockThreadParams")(
    function* (method: string, payload: unknown) {
      yield* verifyProcess;
      const params = isRecord(payload) ? payload : {};
      const cwd = typeof params.cwd === "string" ? params.cwd : null;
      const [configRead, skillsList] = yield* Effect.all([
        rawRequest("config/read", cwd === null ? {} : { cwd }),
        rawRequest("skills/list", { ...(cwd === null ? {} : { cwds: [cwd] }), forceReload: true }),
      ]);
      const found = { mcpServers: mcpServerNames(configRead), skills: nonSystemSkills(skillsList) };
      yield* Effect.logInfo("skycot-family.codex.thread-locked", {
        method,
        mcpServersOff: found.mcpServers.length,
        skillsOff: found.skills.length,
      });
      return {
        ...params,
        config: familyThreadConfig(
          isRecord(params.config) ? (params.config as Record<string, Schema.Json>) : undefined,
          found,
        ),
      };
    },
    (effect, method) =>
      effect.pipe(
        Effect.mapError((error) =>
          error.message === FAMILY_CODEX_REFUSAL ? error : refusal(method, error.message),
        ),
      ),
  );

  const intercept = (method: string, payload: unknown, send: RawRequest) => {
    if (BLOCKED_METHODS.has(method)) {
      return Effect.logWarning("skycot-family.codex.blocked-request", { method }).pipe(
        Effect.andThen(Effect.fail(refusal(method, "blocked while the Family profile is on"))),
      );
    }
    if (TURN_METHODS.has(method) && tainted !== null) {
      return Effect.fail(refusal(method, `MCP server ${tainted} started`));
    }
    if (THREAD_METHODS.has(method)) {
      return lockThreadParams(method, payload).pipe(
        Effect.flatMap((locked) => send(method, locked)),
      );
    }
    return send(method, payload);
  };

  const raw = {
    ...client.raw,
    request: (method: string, payload?: unknown) => intercept(method, payload, rawRequest),
  };
  return {
    ...client,
    raw,
    request: ((method: string, payload: unknown) =>
      intercept(method, payload, (m, p) =>
        client.request(m as never, p as never),
      )) as Client["request"],
  };
}
