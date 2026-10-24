// The fallback inside the Family profile: a turn only ever runs where the child could start one
// right now (the gate's own judgement: bedtime, daily time and messages, the allowance line),
// only on assistants the profile allows, and a move to another company reaches the grown-ups'
// Today and recap.
import type { OrchestrationV2Command, ServerProvider, ThreadId } from "@t3tools/contracts";
import { CommandId, MessageId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import {
  CLAUDE_ACCOUNT_OUT,
  FABLE_RESET,
  NOW,
  claude,
  codex,
  cursor,
  projection,
  provider,
  run,
  selection,
  usageLimitError,
  window,
} from "./fixtures.test-helpers.ts";
import { makeFallback, makeTurnRule } from "./SkycotModelFallback.ts";
import { SWITCH_FILE_NAME, makeMemorySwitchStore, makeSwitchStore } from "./switchLog.ts";

const CODE = "482913";
// NOW is Saturday 24 October 2026, 8 pm in Melbourne.
const MELBOURNE = "Australia/Melbourne";
const THREAD = "thread-ava";
const FABLE = selection("claudeAgent", "claude-fable-5-1");
const OPUS = selection("claudeAgent", "claude-opus-5-5");
const HOUR_LEFT_75 = window("primary", "Session", 75, NOW + 3_600_000);

/** What the engine's provider snapshots say: the allowance line reads them, as in the gate. */
const snapshots: { current: ReadonlyArray<ServerProvider> } = { current: [] };
const layerSnapshots = Layer.mock(ProviderRegistry.ProviderRegistry)({
  getProviders: Effect.sync(() => snapshots.current),
});
const rulesWith = (
  rule: ReturnType<typeof makeTurnRule>,
  providers: ReadonlyArray<ServerProvider>,
) =>
  Effect.suspend(() => {
    snapshots.current = providers;
    return rule(THREAD, providers);
  });

const withFamily = <A, E, R>(
  use: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
    readonly dir: string;
    /** Ava, the only child, using SKYCOT on the Mac; she started THREAD. */
    readonly ava: string;
    readonly rule: ReturnType<typeof makeTurnRule>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-model-fallback-" });
    return yield* Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      yield* TestClock.setTime(NOW);
      const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
      const ava = status.children[0]!.id;
      yield* limits.choose({ sessionId: "mac", childId: ava, grownUp: false });
      yield* limits.recordStart({ sessionId: "mac", threadId: THREAD });
      const rule = makeTurnRule({ family: Option.some(family), limits: Option.some(limits) });
      return yield* use({ family, limits, dir, ava, rule });
    }).pipe(
      Effect.provide(
        SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)).pipe(
          Layer.provideMerge(SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME))),
          Layer.provide(layerSnapshots),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.ensuring(Effect.sync(() => (snapshots.current = []))));

/** The engine as far as the fallback sees it: one thread whose run a limit stopped. */
const stoppedEngine = Effect.gen(function* () {
  const failed = run({ id: "run-1", ordinal: 1, modelSelection: FABLE });
  const state = projection({ runs: [failed], turnItems: [usageLimitError(failed, FABLE_RESET)] });
  const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
  const engine = {
    dispatch: (command: OrchestrationV2Command) =>
      Ref.update(dispatched, (all) => [...all, command]).pipe(
        Effect.as({ sequence: 1, storedEvents: [] }),
      ),
    getThreadShell: () => Effect.succeed({ modelSelection: FABLE, activeRunId: null }),
    getThreadProjection: () => Effect.succeed(state),
    streamDomainEvents: Stream.empty,
  } as unknown as Orchestrator.OrchestratorV2["Service"];
  return { engine, dispatched };
});

const PROVIDERS: ReadonlyArray<ServerProvider> = [claude(), codex()];

it.layer(NodeServices.layer)("SkycotModelFallback in the Family profile", (it) => {
  it.effect("runs a child's turn only on allowed assistants, above their keep line", () =>
    withFamily(({ family, ava, rule }) =>
      Effect.gen(function* () {
        // Codex and Claude are locked down; Cursor was never allowed.
        const open = yield* rulesWith(rule, [claude(), codex(), cursor()]);
        assert.isTrue(open(codex()));
        assert.isTrue(open(claude()));
        assert.isFalse(open(cursor()));
        // A grown-up allows Cursor with the parent code: now it may be chosen.
        yield* family.allowAssistant({ code: CODE, driver: "cursor" });
        assert.isTrue((yield* rulesWith(rule, [cursor()]))(cursor()));

        // Ava keeps 30% of an allowance for the grown-ups: ChatGPT at 25% left is theirs.
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { keepAllowancePercent: 30 } },
        });
        const low = codex([HOUR_LEFT_75]);
        assert.isFalse((yield* rulesWith(rule, [low]))(low));
        const roomy = codex([window("primary", "Session", 10, NOW + 3_600_000)]);
        assert.isTrue((yield* rulesWith(rule, [roomy]))(roomy));
        // A conversation that is no child's: only the allowed-assistant rule applies.
        assert.isTrue((yield* rule("thread-grown-up", [low]))(low));

        yield* family.disable({ code: CODE }).pipe(Effect.ignore);
        assert.isTrue((yield* rulesWith(rule, [cursor()]))(cursor()));
      }),
    ),
  );

  it.effect("at bedtime nothing is startable for the child, so nothing is carried on", () =>
    withFamily(({ family, ava, rule }) =>
      Effect.gen(function* () {
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { bedtime: { start: "19:30", end: "07:00" } } },
        });
        assert.isFalse((yield* rulesWith(rule, PROVIDERS))(claude()));
        snapshots.current = PROVIDERS;
        const { engine, dispatched } = yield* stoppedEngine;
        const store = yield* makeMemorySwitchStore;
        const fallback = yield* makeFallback(engine, {
          getProviders: Effect.sync(() => snapshots.current),
          store,
          turnRuleFor: rule,
        });
        yield* fallback.carryOn(THREAD as ThreadId, "run-1");
        // Exactly as upstream leaves it: waiting, nothing sent, nothing new to show.
        assert.lengthOf(yield* Ref.get(dispatched), 0);
        assert.lengthOf(yield* store.switchesFor(THREAD), 0);
        assert.isNull(yield* store.memoryFor(THREAD));
      }),
    ),
  );

  it.effect("out of messages for today: the same as a new turn, no continuation", () =>
    withFamily(({ family, ava, limits, rule }) =>
      Effect.gen(function* () {
        yield* family.updateChild({ childId: ava, patch: { limits: { dailyTurns: 1 } } });
        // The turn the limit stopped was today's one message.
        yield* limits.admitTurn({ sessionId: "mac", instanceId: "claudeAgent" });
        snapshots.current = PROVIDERS;
        const { engine, dispatched } = yield* stoppedEngine;
        const fallback = yield* makeFallback(engine, {
          getProviders: Effect.sync(() => snapshots.current),
          store: yield* makeMemorySwitchStore,
          turnRuleFor: rule,
        });
        yield* fallback.carryOn(THREAD as ThreadId, "run-1");
        assert.lengthOf(yield* Ref.get(dispatched), 0);
      }),
    ),
  );

  it.effect("within the child's limits a stopped turn is carried on once, uncounted", () =>
    withFamily(({ limits, rule }) =>
      Effect.gen(function* () {
        snapshots.current = PROVIDERS;
        const { engine, dispatched } = yield* stoppedEngine;
        const store = yield* makeMemorySwitchStore;
        const fallback = yield* makeFallback(engine, {
          getProviders: Effect.sync(() => snapshots.current),
          store,
          turnRuleFor: rule,
        });
        yield* fallback.carryOn(THREAD as ThreadId, "run-1");
        yield* fallback.carryOn(THREAD as ThreadId, "run-1");
        const sent = yield* Ref.get(dispatched);
        assert.lengthOf(sent, 1);
        assert.deepStrictEqual(
          (sent[0] as Extract<OrchestrationV2Command, { type: "message.dispatch" }>).modelSelection,
          OPUS,
        );
        assert.lengthOf(yield* store.switchesFor(THREAD), 1);
        // It is the same turn: today's message count is unchanged.
        const session = yield* limits.forSession({ sessionId: "mac" });
        assert.equal(session.limits?.turns, 0);
      }),
    ),
  );

  it.effect("the before-turn swap never moves a turn to where the gate would refuse it", () =>
    withFamily(({ family, ava, rule }) =>
      Effect.gen(function* () {
        // All of Claude rests and ChatGPT is at Ava's keep line: no move at all.
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { keepAllowancePercent: 30 } },
        });
        snapshots.current = [claude(CLAUDE_ACCOUNT_OUT), codex([HOUR_LEFT_75])];
        const { engine, dispatched } = yield* stoppedEngine;
        const store = yield* makeMemorySwitchStore;
        const fallback = yield* makeFallback(engine, {
          getProviders: Effect.sync(() => snapshots.current),
          store,
          turnRuleFor: rule,
        });
        const message = {
          type: "message.dispatch" as const,
          commandId: CommandId.make("command-1"),
          messageId: MessageId.make("message-1"),
          threadId: THREAD as ThreadId,
          text: "Make the cat jump",
          attachments: [],
          modelSelection: FABLE,
          dispatchMode: { type: "start_immediately" as const },
          createdBy: "user" as const,
          creationSource: "web" as const,
        };
        yield* fallback.service.dispatch(message);
        assert.deepStrictEqual(
          (
            (yield* Ref.get(dispatched))[0] as Extract<
              OrchestrationV2Command,
              { type: "message.dispatch" }
            >
          ).modelSelection,
          FABLE,
        );
        assert.lengthOf(yield* store.switchesFor(THREAD), 0);

        // At bedtime not even the same company's next model is chosen: the gate refuses the
        // message before it reaches the engine, and the swap adds no way round it.
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { bedtime: { start: "19:30", end: "07:00" } } },
        });
        snapshots.current = PROVIDERS;
        const asleep = yield* makeFallback(engine, {
          getProviders: Effect.sync(() => snapshots.current),
          store,
          turnRuleFor: rule,
        });
        yield* asleep.service.dispatch({ ...message, messageId: MessageId.make("message-2") });
        assert.deepStrictEqual(
          (
            (yield* Ref.get(dispatched))[1] as Extract<
              OrchestrationV2Command,
              { type: "message.dispatch" }
            >
          ).modelSelection,
          FABLE,
        );
        assert.lengthOf(yield* store.switchesFor(THREAD), 0);
      }),
    ),
  );

  it.effect("tells the grown-ups when a child's turn moved to another company", () =>
    withFamily(({ limits, dir, ava }) =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const store = yield* makeSwitchStore(path.join(dir, SWITCH_FILE_NAME));
        const at = yield* Clock.currentTimeMillis;
        const base = {
          at,
          threadId: THREAD,
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
        assert.equal((yield* limits.switchesFor(THREAD)).length, 2);
        assert.equal((yield* limits.switchesFor("thread-other")).length, 0);
      }),
    ),
  );

  it.effect("without the limits reader, only the allowed-assistant rule applies", () =>
    withFamily(({ family }) =>
      Effect.gen(function* () {
        const rule = makeTurnRule({ family: Option.some(family), limits: Option.none() });
        const open = yield* rulesWith(rule, []);
        assert.isTrue(open(provider({ instanceId: "codex", driver: "codex", models: [] })));
        assert.isFalse(open(cursor()));
      }),
    ),
  );
});
