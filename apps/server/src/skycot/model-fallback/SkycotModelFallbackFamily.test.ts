// The fallback inside the Family profile: a child is only moved to an assistant the profile
// allows and never onto one at the child's "keep for the grown-ups" line, and a move to another
// company reaches the grown-ups' Today and recap.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import { NOW, claude, codex, cursor, provider, window } from "./fixtures.test-helpers.ts";
import { makeMoveRule } from "./SkycotModelFallback.ts";
import { SWITCH_FILE_NAME, makeSwitchStore } from "./switchLog.ts";

const CODE = "482913";

const withFamily = <A, E, R>(
  use: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
    readonly dir: string;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-model-fallback-" });
    return yield* Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      return yield* use({ family, limits, dir });
    }).pipe(
      Effect.provide(
        SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)).pipe(
          Layer.provideMerge(SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME))),
        ),
      ),
    );
  }).pipe(Effect.scoped);

it.layer(NodeServices.layer)("SkycotModelFallback in the Family profile", (it) => {
  it.effect("moves a child only to allowed assistants above their keep line", () =>
    withFamily(({ family, limits, dir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* TestClock.setTime(NOW);
        const status = yield* family.enable({ code: CODE, childName: "Ava" });
        const ava = status.children[0]!.id;
        yield* limits.choose({ sessionId: "mac", childId: ava, grownUp: false });
        yield* limits.recordStart({ sessionId: "mac", threadId: "thread-ava" });
        const rule = makeMoveRule({
          family: Option.some(family),
          activityPath: path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME),
          fs: Option.some(fs),
        });

        // Codex and Claude are locked down; Cursor was never allowed.
        const open = yield* rule("thread-ava", NOW);
        assert.isTrue(open(codex()));
        assert.isFalse(open(cursor()));
        // A grown-up allows Cursor with the parent code: now it may be chosen.
        yield* family.allowAssistant({ code: CODE, driver: "cursor" });
        assert.isTrue((yield* rule("thread-ava", NOW))(cursor()));

        // Ava keeps 30% of an allowance for the grown-ups: ChatGPT at 25% left is theirs.
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { keepAllowancePercent: 30 } },
        });
        const kept = yield* rule("thread-ava", NOW);
        assert.isFalse(kept(codex([window("primary", "Session", 75, NOW + 3_600_000)])));
        assert.isTrue(kept(codex([window("primary", "Session", 10, NOW + 3_600_000)])));
        // Another conversation nobody owns: only the allowed-assistant rule applies.
        const unowned = yield* rule("thread-other", NOW);
        assert.isTrue(unowned(codex([window("primary", "Session", 75, NOW + 3_600_000)])));

        yield* family.disable({ code: CODE }).pipe(Effect.ignore);
        const off = yield* rule("thread-ava", NOW);
        assert.isTrue(off(cursor()));
      }),
    ),
  );

  it.effect("tells the grown-ups when a child's turn moved to another company", () =>
    withFamily(({ family, limits, dir }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        yield* TestClock.setTime(NOW);
        const status = yield* family.enable({ code: CODE, childName: "Ava" });
        const ava = status.children[0]!.id;
        yield* limits.choose({ sessionId: "mac", childId: ava, grownUp: false });
        yield* limits.recordStart({ sessionId: "mac", threadId: "thread-ava" });
        const store = yield* makeSwitchStore(path.join(dir, SWITCH_FILE_NAME));
        const at = yield* Clock.currentTimeMillis;
        const base = {
          at,
          threadId: "thread-ava",
          from: { instanceId: "claudeAgent", driver: "claudeAgent", model: "claude-fable-5-1" },
          until: at + 3_600_000,
        };
        // Within the company: the plain line only.
        yield* store.record({
          ...base,
          messageId: "message-1",
          to: { instanceId: "claudeAgent", driver: "claudeAgent", model: "claude-opus-5-5" },
          crossProvider: false,
        });
        yield* store.record({
          ...base,
          messageId: "message-2",
          to: { instanceId: "codex", driver: "codex", model: "gpt-6-astra" },
          crossProvider: true,
        });

        const today = yield* limits.today;
        const switches = today.children.find((child) => child.childId === ava)?.switches ?? [];
        assert.deepStrictEqual(
          switches.map((entry) => [entry.from, entry.to]),
          [["claudeAgent", "codex"]],
        );
        const snapshot = yield* limits.snapshot;
        assert.equal(snapshot?.activity.switches?.length, 1);
        // The conversation's own lines: both switches.
        assert.equal((yield* limits.switchesFor("thread-ava")).length, 2);
        assert.equal((yield* limits.switchesFor("thread-other")).length, 0);
      }),
    ),
  );

  it.effect("a provider snapshot without limits keeps a child's move open", () =>
    withFamily(({ family }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava" });
        const rule = makeMoveRule({
          family: Option.some(family),
          activityPath: null,
          fs: Option.none(),
        });
        const open = yield* rule("thread-ava", NOW);
        assert.isTrue(open(provider({ instanceId: "codex", driver: "codex", models: [] })));
        assert.isTrue(open(claude()));
      }),
    ),
  );
});
