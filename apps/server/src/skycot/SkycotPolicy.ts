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

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { filesFromPrompt, type PromptFile } from "@t3tools/skycot-rules/files";
import { readCommandAsk, type RuleRequest } from "@t3tools/skycot-rules/rules";

import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";

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

/**
 * Wraps the engine's RuntimePolicyV2: resolves as before, then applies the override only
 * for threads whose *resolved* mode is `auto-accept-edits`. Disabled, it is the identity.
 */
export function layerRuntimePolicy(options: {
  readonly enabled: boolean;
}): Layer.Layer<RuntimePolicy.RuntimePolicyV2, never, RuntimePolicy.RuntimePolicyV2> {
  return Layer.effect(
    RuntimePolicy.RuntimePolicyV2,
    Effect.gen(function* () {
      const base = yield* RuntimePolicy.RuntimePolicyV2;
      if (!options.enabled) return base;
      return RuntimePolicy.RuntimePolicyV2.of({
        resolve: (input) =>
          base.resolve(input).pipe(
            Effect.map((policy) =>
              appliesToRuntimeMode(policy.runtimeMode)
                ? ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
                    ...policy,
                    approvalPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.approvalPolicy,
                    sandboxPolicy: SKYCOT_RUNTIME_POLICY_OVERRIDE.sandboxPolicy,
                  })
                : policy,
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
