import type {
  OrchestrationV2Command,
  OrchestrationV2ThreadProjection,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { CommandId, MessageId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import {
  CLAUDE_ACCOUNT_OUT,
  FABLE_RESET,
  HOUR,
  NOW,
  claude,
  codex,
  projection,
  run,
  selection,
  usageLimitError,
  window,
} from "./fixtures.test-helpers.ts";
import {
  SWITCH_MESSAGE_PREFIX,
  judgeBeforeTurn,
  judgedBeforeTurn,
  makeFallback,
  planContinuation,
} from "./SkycotModelFallback.ts";
import { makeMemorySwitchStore } from "./switchLog.ts";

const FABLE = selection("claudeAgent", "claude-fable-5-1");
const OPUS = selection("claudeAgent", "claude-opus-5-5");
const SONNET = selection("claudeAgent", "claude-sonnet-5-5");
const GPT = selection("codex", "gpt-6-astra");

type Dispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const message = (overrides: Partial<Dispatch> = {}): Dispatch => ({
  type: "message.dispatch",
  commandId: CommandId.make("command-1"),
  messageId: MessageId.make("message-1"),
  threadId: "thread-1" as ThreadId,
  text: "Make the cat jump",
  attachments: [],
  modelSelection: FABLE,
  dispatchMode: { type: "start_immediately" },
  createdBy: "user",
  creationSource: "web",
  ...overrides,
});

describe("before a turn", () => {
  it("judges a person's new message, never steering, notices or maintenance", () => {
    assert.isTrue(judgedBeforeTurn(message()));
    assert.isFalse(
      judgedBeforeTurn(
        message({ dispatchMode: { type: "steer_active", targetRunId: "run-1" as never } }),
      ),
    );
    assert.isFalse(judgedBeforeTurn(message({ text: "/compact" })));
    assert.isFalse(
      judgedBeforeTurn(message({ messageId: MessageId.make(`${SWITCH_MESSAGE_PREFIX}run-1`) })),
    );
    assert.isFalse(judgedBeforeTurn(message({ usageLimitContinuationOfRunId: "run-1" as never })));
  });

  it("moves a resting model's turn and remembers the person's choice", () => {
    const judgement = judgeBeforeTurn({
      requested: FABLE,
      memory: null,
      providers: [claude(), codex()],
      learned: [],
      now: NOW,
    });
    assert.equal(judgement.type, "switch");
    if (judgement.type !== "switch") return;
    assert.deepStrictEqual(judgement.selection, OPUS);
    assert.deepStrictEqual(judgement.preferred, FABLE);
    assert.equal(judgement.choice.until, FABLE_RESET);
  });

  it("goes back to the person's choice once it has reset", () => {
    const judgement = judgeBeforeTurn({
      requested: OPUS,
      memory: { preferred: FABLE, fallback: OPUS },
      providers: [claude([]), codex()],
      learned: [],
      now: FABLE_RESET + 1,
    });
    assert.deepStrictEqual(judgement, { type: "back", selection: FABLE });
  });

  it("stays on the fallback, quietly, while the person's choice still rests", () => {
    const judgement = judgeBeforeTurn({
      requested: OPUS,
      memory: { preferred: FABLE, fallback: OPUS },
      providers: [claude(), codex()],
      learned: [],
      now: NOW + HOUR,
    });
    assert.deepStrictEqual(judgement, { type: "unchanged", forget: false });
  });

  it("a model the person picks meanwhile is theirs", () => {
    const judgement = judgeBeforeTurn({
      requested: SONNET,
      memory: { preferred: FABLE, fallback: OPUS },
      providers: [claude(), codex()],
      learned: [],
      now: NOW,
    });
    assert.deepStrictEqual(judgement, { type: "unchanged", forget: true });
  });

  it("nothing usable: the message goes as asked", () => {
    const judgement = judgeBeforeTurn({
      requested: FABLE,
      memory: null,
      providers: [claude(CLAUDE_ACCOUNT_OUT), codex()],
      learned: [],
      now: NOW,
      mayRunOn: () => false,
    });
    assert.deepStrictEqual(judgement, { type: "unchanged", forget: false });
  });
});

describe("when a limit stops a turn half-way", () => {
  const fableRun = run({ id: "run-1", ordinal: 1, modelSelection: FABLE });

  it("carries the turn on once, on the same company's next best model", () => {
    const plan = planContinuation({
      projection: projection({
        runs: [fableRun],
        turnItems: [usageLimitError(fableRun, FABLE_RESET)],
      }),
      runId: "run-1",
      providers: [claude(), codex()],
      learned: [],
      now: NOW,
    });
    assert.equal(plan.type, "continue");
    if (plan.type !== "continue") return;
    assert.deepStrictEqual(plan.command.modelSelection, OPUS);
    assert.equal(plan.command.manualContinuationOfRunId, "run-1");
    assert.equal(plan.command.messageId, `${SWITCH_MESSAGE_PREFIX}run-1`);
    assert.equal(plan.command.text, "Continue where you left off.");
    assert.deepStrictEqual(plan.command.dispatchMode, { type: "start_immediately" });
    assert.deepStrictEqual(plan.learned, [
      { instanceId: "claudeAgent", model: "claude-fable-5-1", until: FABLE_RESET },
    ]);
    assert.equal(plan.until, FABLE_RESET);
  });

  it("the same reset twice in one turn means the whole account: then another company", () => {
    const reset = NOW + 5 * HOUR;
    const first = run({ id: "run-1", ordinal: 1, modelSelection: FABLE });
    const second = run({
      id: "run-2",
      ordinal: 2,
      modelSelection: OPUS,
      userMessageId: `${SWITCH_MESSAGE_PREFIX}run-1`,
    });
    const plan = planContinuation({
      projection: projection({
        runs: [first, second],
        turnItems: [usageLimitError(first, reset), usageLimitError(second, reset)],
        messageIds: [`${SWITCH_MESSAGE_PREFIX}run-1`],
      }),
      runId: "run-2",
      providers: [claude([]), codex()],
      learned: [],
      now: NOW,
    });
    assert.equal(plan.type, "continue");
    if (plan.type !== "continue") return;
    assert.deepStrictEqual(plan.command.modelSelection, GPT);
    assert.isTrue(plan.choice.crossProvider);
    assert.equal(String(plan.chainRoot.id), "run-1");
    assert.deepStrictEqual(plan.learned, [
      { instanceId: "claudeAgent", model: null, until: reset },
    ]);
  });

  it("stops when every model was tried, and leaves the wait to the engine", () => {
    const runs = [
      run({ id: "run-1", ordinal: 1, modelSelection: FABLE }),
      run({
        id: "run-2",
        ordinal: 2,
        modelSelection: GPT,
        userMessageId: `${SWITCH_MESSAGE_PREFIX}run-1`,
      }),
    ];
    const plan = planContinuation({
      projection: projection({
        runs,
        turnItems: runs.map((step) => usageLimitError(step, null)),
        messageIds: [`${SWITCH_MESSAGE_PREFIX}run-1`],
      }),
      runId: "run-2",
      providers: [
        claude(CLAUDE_ACCOUNT_OUT),
        codex([window("primary", "Session", 100, NOW + 4 * HOUR)]),
      ],
      learned: [],
      now: NOW,
    });
    assert.equal(plan.type, "wait");
  });

  it("waits for the failure to be projected, ignores other failures and handled runs", () => {
    const providers = [claude(), codex()];
    assert.equal(
      planContinuation({
        projection: projection({ runs: [fableRun], turnItems: [] }),
        runId: "run-1",
        providers,
        learned: [],
        now: NOW,
      }).type,
      "pending",
    );
    assert.equal(
      planContinuation({
        projection: projection({
          runs: [fableRun],
          turnItems: [usageLimitError(fableRun, null, "provider_error")],
        }),
        runId: "run-1",
        providers,
        learned: [],
        now: NOW,
      }).type,
      "ignore",
    );
    assert.equal(
      planContinuation({
        projection: projection({
          runs: [fableRun],
          turnItems: [usageLimitError(fableRun, FABLE_RESET)],
          messageIds: [`${SWITCH_MESSAGE_PREFIX}run-1`],
        }),
        runId: "run-1",
        providers,
        learned: [],
        now: NOW,
      }).type,
      "ignore",
    );
  });
});

/** The engine as far as the fallback sees it: dispatches recorded, one thread. */
const fakeEngine = (input: {
  readonly projection: Ref.Ref<OrchestrationV2ThreadProjection>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationV2Command>>;
}) =>
  ({
    dispatch: (command: OrchestrationV2Command) =>
      Ref.update(input.dispatched, (all) => [...all, command]).pipe(
        Effect.as({ sequence: 1, storedEvents: [] }),
      ),
    getThreadShell: () =>
      Ref.get(input.projection).pipe(
        Effect.map((current) => ({
          modelSelection: current.thread.modelSelection,
          activeRunId: null,
        })),
      ),
    getThreadProjection: () => Ref.get(input.projection),
    streamDomainEvents: Stream.empty,
  }) as unknown as Orchestrator.OrchestratorV2["Service"];

describe("the fallback in front of the engine", () => {
  it.effect("moves the message, notes it once, and goes back after the reset", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const first = run({ id: "run-0", ordinal: 0, modelSelection: FABLE, status: "completed" });
      const state = yield* Ref.make(projection({ runs: [first], turnItems: [] }));
      const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
      const providers = yield* Ref.make<ReadonlyArray<ServerProvider>>([claude(), codex()]);
      const store = yield* makeMemorySwitchStore;
      const fallback = yield* makeFallback(fakeEngine({ projection: state, dispatched }), {
        getProviders: Ref.get(providers),
        store,
        turnRuleFor: () => Effect.succeed(() => true),
      });

      yield* fallback.service.dispatch(message());
      const sent = (yield* Ref.get(dispatched))[0] as Dispatch;
      assert.deepStrictEqual(sent.modelSelection, OPUS);
      const notes = yield* store.switchesFor("thread-1");
      assert.equal(notes.length, 1);
      assert.deepStrictEqual(
        { from: notes[0]!.from.model, to: notes[0]!.to.model, cross: notes[0]!.crossProvider },
        { from: "claude-fable-5-1", to: "claude-opus-5-5", cross: false },
      );

      // The client sends the conversation's (now Opus) model with the next message.
      yield* Ref.update(state, (current) => ({
        ...current,
        thread: { ...current.thread, modelSelection: OPUS },
      }));
      yield* fallback.service.dispatch(
        message({ messageId: MessageId.make("message-2"), modelSelection: OPUS }),
      );
      assert.deepStrictEqual(((yield* Ref.get(dispatched))[1] as Dispatch).modelSelection, OPUS);
      assert.equal((yield* store.switchesFor("thread-1")).length, 1);

      // Fable's week resets: the person's own choice is back.
      yield* TestClock.setTime(FABLE_RESET + 1);
      yield* Ref.set(providers, [claude([]), codex()]);
      yield* fallback.service.dispatch(
        message({ messageId: MessageId.make("message-3"), modelSelection: OPUS }),
      );
      assert.deepStrictEqual(((yield* Ref.get(dispatched))[2] as Dispatch).modelSelection, FABLE);
      assert.isNull(yield* store.memoryFor("thread-1"));
    }),
  );

  it.effect("carries a stopped turn on once, however many events say it failed", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const failed = run({ id: "run-1", ordinal: 1, modelSelection: FABLE });
      const state = yield* Ref.make(
        projection({ runs: [failed], turnItems: [usageLimitError(failed, FABLE_RESET)] }),
      );
      const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
      const store = yield* makeMemorySwitchStore;
      const fallback = yield* makeFallback(fakeEngine({ projection: state, dispatched }), {
        getProviders: Effect.succeed([claude(), codex()]),
        store,
        turnRuleFor: () => Effect.succeed(() => true),
      });
      yield* fallback.carryOn("thread-1" as ThreadId, "run-1");
      yield* fallback.carryOn("thread-1" as ThreadId, "run-1");
      const sent = yield* Ref.get(dispatched);
      assert.equal(sent.length, 1);
      const continuation = sent[0] as Dispatch;
      assert.deepStrictEqual(continuation.modelSelection, OPUS);
      assert.equal(continuation.manualContinuationOfRunId, "run-1");
      assert.deepStrictEqual(yield* store.memoryFor("thread-1"), {
        preferred: FABLE,
        fallback: OPUS,
      });
      const [note] = yield* store.switchesFor("thread-1");
      assert.equal(note?.continuationOf, "run-1");
      assert.equal(note?.until, FABLE_RESET);
    }),
  );

  it.effect("does nothing when nothing is usable: upstream's recovery waits", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const failed = run({ id: "run-1", ordinal: 1, modelSelection: FABLE });
      const state = yield* Ref.make(
        projection({ runs: [failed], turnItems: [usageLimitError(failed, NOW + 2 * HOUR)] }),
      );
      const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
      const fallback = yield* makeFallback(fakeEngine({ projection: state, dispatched }), {
        getProviders: Effect.succeed([
          claude(CLAUDE_ACCOUNT_OUT),
          codex([window("primary", "Session", 100, NOW + HOUR)]),
        ]),
        store: yield* makeMemorySwitchStore,
        turnRuleFor: () => Effect.succeed(() => true),
      });
      yield* fallback.carryOn("thread-1" as ThreadId, "run-1");
      assert.equal((yield* Ref.get(dispatched)).length, 0);
    }),
  );
});
