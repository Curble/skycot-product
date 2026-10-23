// nondev-seam: skycot-policy-files
// Family lockdown for Claude (see SkycotFamilyLockdown.ts for when it applies).
//
// The Claude Agent SDK loads everything the parent set up for Claude Code unless told not to:
// user, project and local settings (enabled plugins, hooks, permission rules, the parent's
// CLAUDE.md), MCP servers from ~/.claude.json, `.mcp.json`, plugins and claude.ai connectors,
// skills, and Claude in Chrome. While the Family profile is on, every query a child's session
// opens is given options that switch all of it off:
//
//   - `settingSources: []`: no settings file is read, so no enabled plugin, hook, permission
//     rule or CLAUDE.md of the parent's reaches the child (SKYCOT's own permission callback and
//     mode still apply: they are options, not settings).
//   - `strictMcpConfig: true` with only the servers SKYCOT passes (none in Family, F18): every
//     other MCP configuration is ignored, plugins' and agents' included; claude.ai connectors
//     are also switched off by environment.
//   - `plugins: []`, `skills: []` (no skill is enabled), `disableAllHooks` in the session's own
//     settings, and `--no-chrome`.
//
// Applied where the query is opened (seam skycot-family-lockdown-claude), below every turn,
// restart and resume. Limits (FAMILY.md): Claude Code's built-in tools stay; administrator-
// managed settings, which a family does not normally have, still apply as Claude intends.

import type { FamilyLockdown } from "./SkycotFamilyLockdown.ts";

/** The SDK query options SKYCOT touches; the rest pass through unchanged. */
export interface ClaudeLockableOptions {
  readonly settingSources?: ReadonlyArray<"user" | "project" | "local"> | undefined;
  readonly strictMcpConfig?: boolean | undefined;
  readonly mcpServers?: Readonly<Record<string, unknown>> | undefined;
  readonly plugins?: ReadonlyArray<unknown> | undefined;
  readonly skills?: ReadonlyArray<string> | "all" | undefined;
  readonly settings?: unknown;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly extraArgs?: Readonly<Record<string, string | null>> | undefined;
}

/**
 * T3's Claude text generation (titles, commit messages) already runs with no tools, no MCP
 * server and no slash commands; while the profile is on, the parent's hooks are off as well.
 */
export function lockTextSettings<S extends object>(
  lockdown: FamilyLockdown | null,
  settings: S,
): S | (S & { readonly disableAllHooks: true }) {
  return lockdown === null ? settings : { ...settings, disableAllHooks: true };
}

/** Environment a Family query runs with on top of its own. */
export const FAMILY_CLAUDE_ENV = { ENABLE_CLAUDEAI_MCP_SERVERS: "false" } as const;

/**
 * Pure: a query's options while the profile is on; the same object when it was off. A
 * settings file path (never passed by the adapter today) is replaced rather than trusted.
 */
export function lockQueryOptions<O extends ClaudeLockableOptions>(
  lockdown: FamilyLockdown | null,
  options: O,
): O {
  if (lockdown === null) return options;
  const settings =
    typeof options.settings === "object" && options.settings !== null
      ? { ...(options.settings as Record<string, unknown>), disableAllHooks: true }
      : { disableAllHooks: true };
  return {
    ...options,
    settingSources: [],
    strictMcpConfig: true,
    plugins: [],
    skills: [],
    settings,
    env: { ...(options.env ?? process.env), ...FAMILY_CLAUDE_ENV },
    extraArgs: { ...options.extraArgs, "no-chrome": null },
  };
}
