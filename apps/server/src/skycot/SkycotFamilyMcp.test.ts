import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyMcp from "./SkycotFamilyMcp.ts";

const threadId = ThreadId.make("thread-family-mcp-guard");
const scope: McpInvocationContext.McpThreadInvocationScope = {
  environmentId: EnvironmentId.make("environment:family-mcp"),
  requestNamespace: "family-mcp",
  thread: {
    threadId,
    providerSessionId: "family-mcp",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration", "preview"]),
  issuedAt: 0,
};

const base = Layer.effect(
  McpSessionRegistry.McpSessionRegistry,
  Effect.gen(function* () {
    const testkit = yield* McpSessionRegistry.McpSessionRegistry;
    return McpSessionRegistry.McpSessionRegistry.of({
      ...testkit,
      resolve: (token) => Effect.succeed(token === "valid" ? scope : undefined),
    });
  }),
).pipe(Layer.provide(McpSessionRegistryTestkit.layer));

describe("SkycotFamilyMcp.guardRegistry", () => {
  it.effect("honours no agent credential while the Family profile is on", () =>
    Effect.gen(function* () {
      const familyOn = yield* Ref.make(false);
      const resolveWith = Effect.gen(function* () {
        const registry = yield* McpSessionRegistry.McpSessionRegistry;
        return yield* registry.resolve("valid");
      }).pipe(
        Effect.provide(
          SkycotFamilyMcp.guardRegistry(base).pipe(
            Layer.provide(Layer.mock(SkycotFamily.SkycotFamily)({ isEnabled: Ref.get(familyOn) })),
          ),
        ),
      );

      assert.equal((yield* resolveWith)?.thread.threadId, threadId);
      yield* Ref.set(familyOn, true);
      // Every tool call authenticates through `resolve`, html_render and html_preview included,
      // so with no scope the MCP endpoint answers 401 before any tool runs.
      assert.isUndefined(yield* resolveWith);
      yield* Ref.set(familyOn, false);
      assert.equal((yield* resolveWith)?.thread.threadId, threadId);
    }),
  );

  it.effect("leaves the registry untouched where there is no Family service", () =>
    Effect.gen(function* () {
      const registry = yield* McpSessionRegistry.McpSessionRegistry;
      assert.isDefined(yield* registry.resolve("valid"));
    }).pipe(Effect.provide(SkycotFamilyMcp.guardRegistry(base))),
  );
});
