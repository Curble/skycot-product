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

/**
 * What the assistant is told when the family says no to a step. Plain words, no one's age:
 * "the family said no" is all it needs. A no only ever stops the step; it never allows anything.
 */
export const FAMILY_DECLINED_MESSAGE =
  "The family said no to this step, so it was not done. Do not try it again. Carry on without it: do the job another way that needs no install and no internet, or say in one short sentence that this part needs a grown-up.";

/** The answer to the same step asked again after a no, without raising another card. */
export const FAMILY_DECLINED_AGAIN_MESSAGE =
  "The family already said no to this exact step, so SKYCOT will not ask again. Carry on without it: do the job another way that needs no install and no internet, or say in one short sentence that this part needs a grown-up.";

/**
 * The steps a Family turn's card was answered "no" to, kept for that turn only: the same tool
 * with the same input is refused at once instead of raising the card again. A later message
 * starts clean, so a grown-up who changes their mind can still be asked. Only a "decline" is
 * recorded (Stop is a cancel and is not); nothing here ever answers yes.
 */
export class FamilyDeclinedSteps {
  private readonly keys = new Set<string>();

  private static key(turnId: string, toolName: string, toolInput: unknown): string {
    return JSON.stringify([turnId, toolName, toolInput]);
  }

  record(turnId: string, toolName: string, toolInput: unknown): void {
    this.keys.add(FamilyDeclinedSteps.key(turnId, toolName, toolInput));
  }

  has(turnId: string, toolName: string, toolInput: unknown): boolean {
    return this.keys.has(FamilyDeclinedSteps.key(turnId, toolName, toolInput));
  }
}
