import { ProviderInstanceId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { SKYCOT_POLICY_ENV } from "./SkycotPolicy.ts";

// Codex keeps a thread's last collaboration mode. The Family profile plans first and gives the
// assistant none of T3's tools (F18), so "Build it" must name the default mode itself, or the
// thread stays in plan mode and the child can never build (beta 2 walkthrough blocker).
const build = (interactionMode: "plan" | "default") =>
  CodexAdapterV2.buildCodexTurnStartParams({
    nativeThreadId: "native-family",
    codexInput: [{ type: "text", text: "Build it" }],
    runtimePolicy: { runtimeMode: "approval-required", interactionMode, cwd: null },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  });

const withPolicy = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const before = process.env[SKYCOT_POLICY_ENV];
      if (value === undefined) delete process.env[SKYCOT_POLICY_ENV];
      else process.env[SKYCOT_POLICY_ENV] = value;
      return before;
    }),
    () => effect,
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env[SKYCOT_POLICY_ENV];
        else process.env[SKYCOT_POLICY_ENV] = before;
      }),
  );

describe("SKYCOT Codex mode", () => {
  it.effect("names the default mode for a turn after a plan, without T3's tools", () =>
    withPolicy(
      "1",
      Effect.gen(function* () {
        const plan = yield* build("plan");
        assert.strictEqual(plan.collaborationMode?.mode, "plan");
        const buildIt = yield* build("default");
        assert.strictEqual(buildIt.collaborationMode?.mode, "default");
        assert.isUndefined(buildIt.collaborationMode?.settings.developer_instructions);
      }),
    ),
  );

  it.effect("leaves T3 Code's own behaviour alone when SKYCOT's policy is off", () =>
    withPolicy(
      undefined,
      Effect.gen(function* () {
        const buildIt = yield* build("default");
        assert.isUndefined(buildIt.collaborationMode);
      }),
    ),
  );
});
