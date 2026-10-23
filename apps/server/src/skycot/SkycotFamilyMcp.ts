// nondev-seam: skycot-policy-files
// While the Family profile is on, the engine honours no agent's MCP credential, so none of its
// own tools (thread control, scheduling, pull requests, worktrees, devices, page previews, and
// html_render / html_preview, whose first use may download a browser of about 200 MB) can be
// called from a child's conversation, whichever assistant runs it and whenever its session began.
//
// ProviderSessionManager already issues a Family thread no credential (seam skycot-family-mcp),
// which keeps the tool names out of the provider's config. This covers what that cannot: a
// session that was live when the profile was turned on keeps the key it started with until it
// stops, and an already-attached thread is not prepared again. MCP clients a person approved
// (OAuth) are not thread credentials and are unaffected; FAMILY.md says so.

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as SkycotFamily from "./SkycotFamily.ts";

/** Wraps the registry layer so `resolve` answers "unknown credential" while the profile is on. */
export const guardRegistry = <E, R>(
  base: Layer.Layer<McpSessionRegistry.McpSessionRegistry, E, R>,
) =>
  Layer.effect(
    McpSessionRegistry.McpSessionRegistry,
    Effect.gen(function* () {
      const delegate = yield* McpSessionRegistry.McpSessionRegistry;
      const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
      if (Option.isNone(family)) return delegate;
      return McpSessionRegistry.McpSessionRegistry.of({
        ...delegate,
        resolve: (rawToken) =>
          family.value.isEnabled.pipe(
            Effect.flatMap((on) => (on ? Effect.succeed(undefined) : delegate.resolve(rawToken))),
          ),
      });
    }),
  ).pipe(Layer.provide(base));
