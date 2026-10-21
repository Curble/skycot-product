// nondev-seam: skycot-policy-files
// SKYCOT policy: configuration and the runtime-policy wrapper.
//
// First principles: the thing that runs the command decides what to ask, so the promise
// "SKYCOT always asks before deleting, publishing, spending or leaving the project" has to be
// kept on the server, not in client copy. The design is "ask for everything, approve on the
// server unless a hard rule matches":
//
//   1. While a thread runs in `auto-accept-edits` ("Just do it, carefully"), this layer
//      overrides the provider policy so the provider asks before every command and file
//      change (Codex: approvalPolicy "untrusted" in a workspace-write sandbox; Claude: the
//      "default" permission mode with the permission callback installed).
//   2. `SkycotPolicyReactor` answers those requests: it approves what no hard rule matches
//      and leaves the rest pending, so the person only sees cards for the risky steps.
//
// Both halves are gated by the same flag so they can never disagree. Off by default so a
// stock T3 Code build is unchanged; `nondev/brand/env.cjs` turns it on for SKYCOT.

import type { OrchestrationV2TurnItem, RuntimeMode } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { filesFromPrompt, type PromptFile } from "@t3tools/skycot-rules/files";
import { readCommandAsk, type RuleRequest } from "@t3tools/skycot-rules/rules";

import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as SkycotFamily from "./SkycotFamily.ts";

export const SKYCOT_POLICY_ENV = "T3CODE_SKYCOT_POLICY";

/** The one runtime mode the policy governs. Ask-me-first already asks; hands-off asks nothing. */
export const SKYCOT_POLICY_RUNTIME_MODE: RuntimeMode = "auto-accept-edits";

export function isSkycotPolicyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[SKYCOT_POLICY_ENV] === "1";
}

/**
 * What the provider is told while the policy governs a turn. Codex reads both keys; Claude
 * only needs `approvalPolicy` to be present and not "never" to install its permission
 * callback in "default" mode (see `permissionModeForClaudeRuntimePolicy`).
 */
export const SKYCOT_RUNTIME_POLICY_OVERRIDE: RuntimePolicy.RuntimePolicyV2Override = {
  approvalPolicy: "untrusted",
  sandboxPolicy: { type: "workspaceWrite" },
};

export function appliesToRuntimeMode(runtimeMode: RuntimeMode): boolean {
  return runtimeMode === SKYCOT_POLICY_RUNTIME_MODE;
}

/** The one mode a Family-profile thread may run in, whatever the thread or the default says. */
export const FAMILY_RUNTIME_MODE: RuntimeMode = "approval-required";

/**
 * A thread while the Family profile is on: "Ask me first", with the provider told to ask
 * before every command and edit (Codex: "untrusted" in a workspace-write sandbox, which also
 * keeps the network off; Claude: the "default" permission mode). `full-access` and
 * `auto-accept-edits` threads are downgraded here, at the point the provider is configured, so
 * no setting, old thread, MCP launch or raw RPC can start a hands-off turn.
 */
export function familyRuntimePolicy(
  policy: ProviderAdapter.ProviderAdapterV2RuntimePolicy,
): ProviderAdapter.ProviderAdapterV2RuntimePolicy {
  return ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    ...policy,
    runtimeMode: FAMILY_RUNTIME_MODE,
    approvalPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.approvalPolicy,
    sandboxPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.sandboxPolicy,
  });
}

/**
 * Wraps the engine's RuntimePolicyV2: resolves as before, then
 *   - while the Family profile is on, downgrades every thread to `familyRuntimePolicy`
 *     (whatever the policy flag says: the profile's promise does not depend on it);
 *   - otherwise, with the policy flag on, applies the override only for threads whose
 *     *resolved* mode is `auto-accept-edits`.
 * The Family service is read optionally so this layer's type stays what upstream expects;
 * the server provides it once at the top of its layer graph (server.ts).
 */
export function layerRuntimePolicy(options: {
  readonly enabled: boolean;
}): Layer.Layer<RuntimePolicy.RuntimePolicyV2, never, RuntimePolicy.RuntimePolicyV2> {
  return Layer.effect(
    RuntimePolicy.RuntimePolicyV2,
    Effect.gen(function* () {
      const base = yield* RuntimePolicy.RuntimePolicyV2;
      const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
      if (!options.enabled && Option.isNone(family)) return base;
      const familyOn = Option.isNone(family) ? Effect.succeed(false) : family.value.isEnabled;
      return RuntimePolicy.RuntimePolicyV2.of({
        resolve: (input) =>
          base.resolve(input).pipe(
            Effect.flatMap((policy) =>
              familyOn.pipe(
                Effect.map((inFamily) =>
                  inFamily
                    ? familyRuntimePolicy(policy)
                    : options.enabled && appliesToRuntimeMode(policy.runtimeMode)
                      ? ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
                          ...policy,
                          approvalPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.approvalPolicy,
                          sandboxPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.sandboxPolicy,
                        })
                      : policy,
                ),
              ),
            ),
          ),
      });
    }),
  );
}

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;

/**
 * The facts the rules need, read from the projection. The approval item's `prompt` is what
 * the provider chose to show (Claude prefers a human title, Codex a reason), so the tool
 * call's own turn item is preferred where it exists: `command_execution.input` is the exact
 * command, `file_change.fileName` the exact path. A Codex prompt that is not the command is
 * the reason it gave for leaving its sandbox, which is a hard rule of its own. Anything
 * unreadable stays undefined and the rules hold it.
 */
export function requestFacts(
  approval: ApprovalItem,
  toolCall: OrchestrationV2TurnItem | null | undefined,
  /** The provider that raised the ask, when the approval item does not name it. */
  driver?: string,
): RuleRequest | null {
  switch (approval.requestKind) {
    case "command": {
      const ask = readCommandAsk({
        driver: approval.nativeItemRef?.driver ?? driver,
        prompt: approval.prompt,
        toolCallInput: toolCall?.type === "command_execution" ? toolCall.input : undefined,
      });
      return {
        kind: "command",
        command: ask.command,
        ...(ask.leavesSandbox
          ? {
              leavesSandbox: true,
              ...(ask.sandboxReason === undefined ? {} : { sandboxReason: ask.sandboxReason }),
            }
          : {}),
      };
    }
    case "file-change":
    case "file-read": {
      const fromPrompt = filesFromPrompt(approval.prompt);
      const files: Array<PromptFile> = [...fromPrompt];
      if (toolCall?.type === "file_change" && !files.some((f) => f.path === toolCall.fileName)) {
        files.push({ path: toolCall.fileName, operation: "change" });
      }
      if (approval.requestKind === "file-read" && files.length === 0 && approval.prompt) {
        // A bare path with no verb.
        const line = approval.prompt.trim().split(/\r?\n/)[0] ?? "";
        if (line.length > 0 && !/\s/.test(line)) files.push({ path: line, operation: "change" });
      }
      return { kind: approval.requestKind, files };
    }
    case "permission":
    case "mcp-elicitation":
      return { kind: approval.requestKind };
  }
}
