// In the Family profile a thread gets no MCP credential (ProviderSessionManager, seam
// skycot-family-mcp), so every adapter reads "no MCP session". These pin, per provider, that "no
// session" builds a provider config that names no engine tool server and no engine tool: the
// assistant is never shown preview_*, html_render, html_preview or the thread tools, so it is not
// tempted to try them. (ACP agents, OpenCode, Muse and Pi attach the server the same way, only
// when a session exists; see FAMILY.md.)
import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ClaudeAdapterV2 from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";

const ENGINE_TOOL_NAMES = /t3-code|html_render|html_preview|preview_open|delegate_task/u;

describe("Family profile: no engine tool server in the provider config", () => {
  it("Claude gets no t3-code server and pre-approves no engine tool", () => {
    const overrides = ClaudeAdapterV2.claudeMcpQueryOverrides({
      mcpSession: undefined,
      readOnlySandbox: false,
    });
    assert.isUndefined(overrides.mcpServers);
    assert.isFalse(ENGINE_TOOL_NAMES.test(JSON.stringify(overrides)));
  });

  it.effect("Codex gets no engine tool instructions or tool context", () =>
    Effect.gen(function* () {
      const params = yield* CodexAdapterV2.buildCodexTurnStartParams({
        nativeThreadId: "native-family",
        codexInput: [{ type: "text", text: "make me a pet page" }],
        runtimePolicy: { runtimeMode: "approval-required", interactionMode: "plan", cwd: null },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        hasT3Mcp: false,
      });
      assert.isUndefined(params.collaborationMode?.settings.developer_instructions);
      assert.isUndefined(params.additionalContext);
      assert.isFalse(ENGINE_TOOL_NAMES.test(JSON.stringify(params)));
    }),
  );
});
