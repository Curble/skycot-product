// nondev-seam: skycot-policy-files
// The model fallback: a child should never see "limit reached". When the model a turn asks for
// has run out of allowance (Claude's top model has a weekly allowance of its own, so it can be
// out while the rest of Claude still works), the engine runs the turn on the best usable model
// of the same company, or else of another company the family is already signed in to, and the
// conversation says so in one plain line. Mark's decision, 24 October 2026: "let it switch to
// another model within the company, or switch to another company the family has already signed
// in to, telling the parent."
//
// Where it is decided: the engine's command entry (OrchestratorV2.dispatch), wrapped once in
// runtimeLayer.ts (seam skycot-model-fallback), so every way a turn starts (the plain client,
// Advanced mode, a scheduled task, upstream's own limit recovery) meets the same judge
// (choose.ts). Two moments:
//   - Before a turn: a person's message to a conversation with nothing running. If the model it
//     asks for is resting, the message is dispatched with the fallback model instead. The
//     engine's own provider switch (with its context hand-off) does the rest when the fallback
//     belongs to another company.
//   - When a limit stops a turn half-way (or the "before" check could not know): the failed run
//     is carried on once on the fallback, with the same "Continue where you left off."
//     continuation the stock client's Resume sends (`manualContinuationOfRunId`). Each model is
//     tried at most once per turn; when nothing is usable, nothing is sent and upstream's
//     recovery waits for the reset as before.
// The person's choice always wins: the model is changed only for as long as it rests. The next
// message after it resets goes back to it, and a model the person picks meanwhile is theirs.
// Family rules always win: a turn only ever runs where the child could start one right now,
// judged exactly as the Family gate judges a turn start (SkycotFamilyLimits `startableOn`, the
// same `evaluateLimits` as `admitTurn`: bedtime, daily time, messages a day, the allowance
// line), and only on an assistant the profile allows. So at bedtime, or with today's messages
// used up, a stopped turn is not carried on: it waits exactly as upstream leaves it. A
// carried-on turn is the same turn, so it is not counted again. A move to another company is
// noted for the grown-ups' Today and recap (switchLog.ts); no notification.
//
// Inert unless T3CODE_SKYCOT_POLICY=1, and without provider snapshots (tests, stripped servers).

import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ThreadId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type ServerProvider,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import { isNativeMaintenanceCommand } from "../../orchestration-v2/CommandPolicy.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { forkParked } from "../../serverActivation.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import { carryPlanPass } from "../SkycotFamilyInstructions.ts";
import { LOCKED_DOWN_DRIVERS } from "../SkycotFamilyLockdown.ts";
import {
  availabilityOf,
  failureScope,
  modelKey,
  sameReset,
  type LearnedLimit,
  type ModelRef,
} from "./availability.ts";
import { chooseModel, type Choice } from "./choose.ts";
import {
  SWITCH_FILE_NAME,
  makeMemorySwitchStore,
  makeSwitchStore,
  type SwitchEnd,
  type SwitchStore,
} from "./switchLog.ts";

/** The message id (and command id) of a continuation the fallback sent: `skycot-switch:<run>`. */
export const SWITCH_MESSAGE_PREFIX = "skycot-switch:";
export const CONTINUE_TEXT = "Continue where you left off.";
/** A failure with no reset time keeps its model aside this long. */
const UNKNOWN_RESET_MS = 15 * 60_000;
/** A turn is carried on at most this many times, whatever the model list says. */
const MAX_CHAIN = 6;

type DispatchCommand = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
type ProjectionPart = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "turnItems" | "messages" | "runtimeRequests"
>;

export const refOf = (selection: Pick<ModelSelection, "instanceId" | "model">): ModelRef => ({
  instanceId: String(selection.instanceId),
  model: selection.model,
});

/** The fallback's selection: the model's own defaults (another model's options may not apply). */
export const selectionOf = (ref: ModelRef): ModelSelection => ({
  instanceId: ProviderInstanceId.make(ref.instanceId),
  model: ref.model,
});

function endOf(ref: ModelRef, providers: ReadonlyArray<ServerProvider>): SwitchEnd {
  const provider = providers.find((candidate) => String(candidate.instanceId) === ref.instanceId);
  return {
    instanceId: ref.instanceId,
    driver: provider === undefined ? "" : String(provider.driver),
    model: ref.model,
  };
}

/** Messages the "before a turn" check leaves alone: everything but a person's own new message. */
export function judgedBeforeTurn(command: DispatchCommand): boolean {
  return (
    command.dispatchMode.type !== "steer_active" &&
    command.dispatchMode.type !== "restart_active" &&
    command.deliveryIntent !== "steer" &&
    command.deliveryIntent !== "restart" &&
    command.notification === undefined &&
    command.delegatedCompletion === undefined &&
    command.restartContinuationOfRunId === undefined &&
    command.usageLimitContinuationOfRunId === undefined &&
    !String(command.messageId).startsWith(SWITCH_MESSAGE_PREFIX) &&
    !isNativeMaintenanceCommand(command)
  );
}

export interface JudgeInput {
  /** The model the message asks for (its own, or the conversation's). */
  readonly requested: ModelSelection;
  /** What the fallback remembers for this conversation. */
  readonly memory: { readonly preferred: ModelSelection; readonly fallback: ModelSelection } | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly learned: ReadonlyArray<LearnedLimit>;
  readonly now: number;
  readonly mayRunOn?: (provider: ServerProvider) => boolean;
}

export type Judgement =
  /** Send as asked. `forget` drops a memory the person overrode by picking another model. */
  | { readonly type: "unchanged"; readonly forget: boolean }
  /** The person's own model is back: send on it again and forget the fallback. */
  | { readonly type: "back"; readonly selection: ModelSelection }
  | {
      readonly type: "switch";
      readonly selection: ModelSelection;
      readonly preferred: ModelSelection;
      readonly choice: Extract<Choice, { readonly type: "switch" }>;
    };

/** Pure: what to do with a person's message before its turn starts. */
export function judgeBeforeTurn(input: JudgeInput): Judgement {
  const { requested, memory } = input;
  const onFallback = memory !== null && modelSelectionsEqual(requested, memory.fallback);
  const wanted = onFallback ? memory.preferred : requested;
  const choice = chooseModel({
    requested: refOf(wanted),
    providers: input.providers,
    learned: input.learned,
    now: input.now,
    ...(input.mayRunOn === undefined ? {} : { mayRunOn: input.mayRunOn }),
  });
  if (choice.type === "keep") {
    return onFallback
      ? { type: "back", selection: wanted }
      : { type: "unchanged", forget: memory !== null };
  }
  if (choice.type === "wait") return { type: "unchanged", forget: memory !== null && !onFallback };
  // Already on the model the judge would pick: nothing new to say.
  if (
    choice.to.instanceId === String(requested.instanceId) &&
    choice.to.model === requested.model
  ) {
    return { type: "unchanged", forget: false };
  }
  return { type: "switch", selection: selectionOf(choice.to), preferred: wanted, choice };
}

export type ContinuationPlan =
  /** The run's failure is not projected yet: look again on the next event. */
  | { readonly type: "pending" }
  /** Not a usage limit, already handled, or the conversation moved on. */
  | { readonly type: "ignore" }
  /** A usage limit, and nothing else is usable: upstream's recovery waits for the reset. */
  | { readonly type: "wait"; readonly learned: ReadonlyArray<LearnedLimit> }
  | {
      readonly type: "continue";
      readonly learned: ReadonlyArray<LearnedLimit>;
      readonly command: DispatchCommand;
      readonly choice: Extract<Choice, { readonly type: "switch" }>;
      /** The run the person's own message started (the chain's first). */
      readonly chainRoot: OrchestrationV2Run;
      /** When the chain's first model comes back, for the note. */
      readonly until: number | null;
    };

const switchMessageOf = (runId: string) => MessageId.make(`${SWITCH_MESSAGE_PREFIX}${runId}`);

/** The runs one turn ran as, oldest first: the person's run, then each continuation's. */
export function turnChain(
  runs: ReadonlyArray<OrchestrationV2Run>,
  last: OrchestrationV2Run,
): ReadonlyArray<OrchestrationV2Run> {
  const chain = [last];
  let current = last;
  while (
    chain.length <= MAX_CHAIN &&
    String(current.userMessageId).startsWith(SWITCH_MESSAGE_PREFIX)
  ) {
    const previousId = String(current.userMessageId).slice(SWITCH_MESSAGE_PREFIX.length);
    const previous = runs.find((run) => String(run.id) === previousId);
    if (previous === undefined) break;
    chain.unshift(previous);
    current = previous;
  }
  return chain;
}

/** Pure: whether and how to carry on a run a usage limit stopped. */
export function planContinuation(input: {
  readonly projection: ProjectionPart;
  readonly runId: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly learned: ReadonlyArray<LearnedLimit>;
  readonly now: number;
  readonly mayRunOn?: (provider: ServerProvider) => boolean;
}): ContinuationPlan {
  const { projection, providers, now } = input;
  const run = projection.runs.find((candidate) => String(candidate.id) === input.runId);
  if (run === undefined) return { type: "ignore" };
  if (run.status !== "failed") return { type: "pending" };
  const failure = latestRootProviderFailure(run, projection.turnItems);
  if (failure === null) return { type: "pending" };
  if (failure.class !== "usage_limit") return { type: "ignore" };
  const thread = projection.thread;
  const snoozed = thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > now;
  if (
    latestExecutedRun(projection.runs)?.id !== run.id ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride === "settled" ||
    snoozed ||
    projection.runtimeRequests.some((request) => request.status === "pending") ||
    projection.messages.some((message) => message.id === switchMessageOf(String(run.id)))
  ) {
    return { type: "ignore" };
  }

  const chain = turnChain(projection.runs, run);
  const resetMs = failure.resetAt == null ? null : Date.parse(failure.resetAt);
  const resetAt = resetMs !== null && Number.isFinite(resetMs) ? resetMs : null;
  const from = refOf(run.modelSelection);
  const provider = providers.find((candidate) => String(candidate.instanceId) === from.instanceId);
  // Another run of this turn on the same provider stopped with the same reset time: the
  // account's allowance, not one model's.
  const sameAccountTwice = chain.slice(0, -1).some((earlier) => {
    if (String(earlier.modelSelection.instanceId) !== from.instanceId) return false;
    const earlierFailure = latestRootProviderFailure(earlier, projection.turnItems);
    const earlierReset =
      earlierFailure?.resetAt == null ? null : Date.parse(earlierFailure.resetAt);
    return sameReset(earlierReset, resetAt);
  });
  const scope =
    sameAccountTwice || provider === undefined ? "account" : failureScope(provider, resetAt);
  const taught: LearnedLimit = {
    instanceId: from.instanceId,
    model: scope === "account" ? null : from.model,
    until: resetAt ?? now + UNKNOWN_RESET_MS,
  };
  if (chain.length > MAX_CHAIN) return { type: "wait", learned: [taught] };
  const learned = [...input.learned, taught];
  const choice = chooseModel({
    requested: from,
    providers,
    learned,
    now,
    tried: new Set(chain.map((step) => modelKey(refOf(step.modelSelection)))),
    ...(input.mayRunOn === undefined ? {} : { mayRunOn: input.mayRunOn }),
  });
  if (choice.type !== "switch") return { type: "wait", learned: [taught] };
  const chainRoot = chain[0]!;
  const root = refOf(chainRoot.modelSelection);
  const rootProvider = providers.find(
    (candidate) => String(candidate.instanceId) === root.instanceId,
  );
  const until =
    rootProvider === undefined
      ? resetAt
      : availabilityOf(rootProvider, root.model, learned, now).until;
  const messageId = switchMessageOf(String(run.id));
  return {
    type: "continue",
    learned: [taught],
    choice,
    chainRoot,
    until,
    command: {
      type: "message.dispatch",
      commandId: CommandId.make(`server:${messageId}`),
      messageId,
      threadId: thread.id,
      text: CONTINUE_TEXT,
      attachments: [],
      modelSelection: selectionOf(choice.to),
      manualContinuationOfRunId: run.id,
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "server",
    },
  };
}

/** The run a domain event may say failed, for the continuation check. */
export function failedRunOf(event: OrchestrationV2DomainEvent): string | null {
  if (event.type === "run.updated" && event.payload.status === "failed") {
    return String(event.payload.id);
  }
  if (
    event.type === "turn-item.updated" &&
    event.payload.type === "error" &&
    event.payload.failure.class === "usage_limit" &&
    event.payload.runId !== null
  ) {
    return String(event.payload.runId);
  }
  return null;
}

export interface FallbackDeps {
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly store: SwitchStore;
  /** The Family rule: the providers this conversation's turn may run on now (`ChoiceInput.mayRunOn`). */
  readonly turnRuleFor: (
    threadId: string,
    providers: ReadonlyArray<ServerProvider>,
  ) => Effect.Effect<(provider: ServerProvider) => boolean>;
}

/** The engine with the fallback in front of `dispatch`, and the half-way watcher to start. */
export const makeFallback = Effect.fn("SkycotModelFallback.make")(function* (
  inner: Orchestrator.OrchestratorV2["Service"],
  deps: FallbackDeps,
) {
  const learnedRef = yield* Ref.make<ReadonlyArray<LearnedLimit>>([]);
  const lock = yield* Semaphore.make(1);
  const handled = new Set<string>();

  const learnedNow = (now: number) =>
    Ref.updateAndGet(learnedRef, (entries) => entries.filter((entry) => entry.until > now));
  const learn = (entries: ReadonlyArray<LearnedLimit>) =>
    Ref.update(learnedRef, (current) => [...current, ...entries]);

  const record = Effect.fn("SkycotModelFallback.record")(function* (input: {
    readonly threadId: string;
    readonly messageId: string;
    readonly choice: Extract<Choice, { readonly type: "switch" }>;
    readonly from: ModelRef;
    readonly until: number | null;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly now: number;
    readonly continuationOf?: string;
  }) {
    const from = endOf(input.from, input.providers);
    const to = endOf(input.choice.to, input.providers);
    yield* deps.store.record({
      at: input.now,
      threadId: input.threadId,
      messageId: input.messageId,
      from,
      to,
      until: input.until,
      crossProvider: input.choice.crossProvider,
      ...(input.continuationOf === undefined ? {} : { continuationOf: input.continuationOf }),
    });
    yield* Effect.logInfo("skycot-model-fallback.switched", {
      threadId: input.threadId,
      from: `${from.driver}:${from.model}`,
      to: `${to.driver}:${to.model}`,
      crossProvider: input.choice.crossProvider,
      midTurn: input.continuationOf !== undefined,
    });
  });

  const beforeTurn = Effect.fn("SkycotModelFallback.beforeTurn")(function* (
    command: DispatchCommand,
  ) {
    if (!judgedBeforeTurn(command)) return command;
    const shell = yield* inner
      .getThreadShell(command.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    // A run is going: the message queues or joins it; leave the model to that run.
    if (shell === null || shell.activeRunId !== null) return command;
    const threadId = String(command.threadId);
    const requested = command.modelSelection ?? shell.modelSelection;
    const memory = yield* deps.store.memoryFor(threadId);
    const providers = yield* deps.getProviders;
    const now = yield* Clock.currentTimeMillis;
    const learned = yield* learnedNow(now);
    const mayRunOn = yield* deps.turnRuleFor(threadId, providers);
    const judgement = judgeBeforeTurn({ requested, memory, providers, learned, now, mayRunOn });
    switch (judgement.type) {
      case "unchanged":
        if (judgement.forget) yield* deps.store.forget(threadId);
        return command;
      case "back":
        yield* deps.store.forget(threadId);
        yield* Effect.logInfo("skycot-model-fallback.back", {
          threadId,
          model: `${judgement.selection.instanceId}:${judgement.selection.model}`,
        });
        return { ...command, modelSelection: judgement.selection };
      case "switch":
        yield* deps.store.remember(threadId, {
          preferred: judgement.preferred,
          fallback: judgement.selection,
        });
        yield* record({
          threadId,
          messageId: String(command.messageId),
          choice: judgement.choice,
          from: refOf(judgement.preferred),
          until: judgement.choice.until,
          providers,
          now,
        });
        return { ...command, modelSelection: judgement.selection };
    }
  });

  const dispatch: Orchestrator.OrchestratorV2["Service"]["dispatch"] = (command) =>
    command.type !== "message.dispatch"
      ? inner.dispatch(command)
      : beforeTurn(command).pipe(
          // The judge never blocks a message: on any trouble it goes as it came.
          Effect.catchCause((cause) =>
            Effect.logWarning("skycot-model-fallback.judge-failed", { cause }).pipe(
              Effect.as(command),
            ),
          ),
          Effect.flatMap((judged) => inner.dispatch(judged)),
        );

  const carryOn = Effect.fn("SkycotModelFallback.carryOn")(
    function* (thread: ThreadId, runId: string) {
      if (handled.has(runId)) return;
      const threadId = String(thread);
      const projection = yield* inner.getThreadProjection(thread);
      const providers = yield* deps.getProviders;
      const now = yield* Clock.currentTimeMillis;
      const learned = yield* learnedNow(now);
      const mayRunOn = yield* deps.turnRuleFor(threadId, providers);
      const plan = planContinuation({ projection, runId, providers, learned, now, mayRunOn });
      if (plan.type === "pending") return;
      handled.add(runId);
      if (plan.type === "ignore") return;
      yield* learn(plan.learned);
      if (plan.type === "wait") {
        yield* Effect.logInfo("skycot-model-fallback.nothing-usable", { threadId, runId });
        return;
      }
      const memory = yield* deps.store.memoryFor(threadId);
      const rootSelection = plan.chainRoot.modelSelection;
      const preferred =
        memory !== null && modelSelectionsEqual(memory.fallback, rootSelection)
          ? memory.preferred
          : rootSelection;
      yield* deps.store.remember(threadId, {
        preferred,
        fallback: selectionOf(plan.choice.to),
      });
      yield* record({
        threadId,
        messageId: String(plan.command.messageId),
        choice: plan.choice,
        from: refOf(rootSelection),
        until: plan.until,
        providers,
        now,
        continuationOf: runId,
      });
      // A build that ran out half-way carries on as a build, not as a new plan.
      const failed = projection.runs.find((candidate) => String(candidate.id) === runId);
      if (failed !== undefined) {
        yield* carryPlanPass(String(failed.userMessageId), String(plan.command.messageId));
      }
      yield* inner.dispatch(plan.command);
    },
    (effect, thread, runId) =>
      effect.pipe(
        lock.withPermits(1),
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot-model-fallback.carry-on-failed", {
            threadId: thread,
            runId,
            cause,
          }),
        ),
      ),
  );

  const start = forkParked(
    Stream.runForEach(inner.streamDomainEvents, (event) => {
      const runId = failedRunOf(event);
      return runId === null ? Effect.void : carryOn(event.threadId, runId);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("skycot-model-fallback.event-stream-failed", { cause }),
      ),
    ),
  );

  return {
    service: { ...inner, dispatch } satisfies Orchestrator.OrchestratorV2["Service"],
    start,
    carryOn,
  };
});

/**
 * The Family rule for a conversation's turn: Codex and Claude, or an assistant a grown-up
 * allowed, and only where the child could start a turn right now (SkycotFamilyLimits'
 * `startableOn`, the gate's own judgement). Everything while the profile is off.
 */
export const makeTurnRule = (input: {
  readonly family: Option.Option<SkycotFamily.SkycotFamily["Service"]>;
  readonly limits: Option.Option<SkycotFamilyLimits.SkycotFamilyLimits["Service"]>;
}): FallbackDeps["turnRuleFor"] =>
  Effect.fn("SkycotModelFallback.turnRuleFor")(function* (threadId, providers) {
    if (Option.isNone(input.family)) return () => true;
    const family = input.family.value;
    if (!(yield* family.isEnabled)) return () => true;
    const status = yield* family.status.pipe(Effect.orElseSucceed(() => null));
    // Codex and Claude run locked down; any other assistant only once a grown-up allowed it.
    const allowed = new Set(status?.allowedAssistants ?? []);
    const instanceIds = providers.map((provider) => String(provider.instanceId));
    const startable = Option.isNone(input.limits)
      ? null
      : yield* input.limits.value.startableOn({ threadId, instanceIds });
    return (provider: ServerProvider) => {
      const driver = String(provider.driver);
      return (
        (LOCKED_DOWN_DRIVERS.has(ProviderDriverKind.make(driver)) || allowed.has(driver)) &&
        (startable === null || startable.has(String(provider.instanceId)))
      );
    };
  });

/**
 * The engine's OrchestratorV2 with the fallback in front. Every outside service is optional
 * (`serviceOption`), so the layer's type is upstream's; without provider snapshots it is the
 * engine unchanged.
 */
const layerWrap = Layer.effect(
  Orchestrator.OrchestratorV2,
  Effect.gen(function* () {
    const inner = yield* Orchestrator.OrchestratorV2;
    const registry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
    if (Option.isNone(registry)) return inner;
    const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
    const path = yield* Effect.serviceOption(Path.Path);
    const files =
      Option.isSome(config) && Option.isSome(fs) && Option.isSome(path)
        ? { stateDir: config.value.stateDir, fs: fs.value, path: path.value }
        : null;
    const store =
      files === null
        ? yield* makeMemorySwitchStore
        : yield* makeSwitchStore(files.path.join(files.stateDir, SWITCH_FILE_NAME)).pipe(
            Effect.provideService(FileSystem.FileSystem, files.fs),
            Effect.provideService(Path.Path, files.path),
          );
    // A read-only reader of the Family activity file the gate keeps (it never counts or writes
    // here), so a carried-on turn meets the child's limits exactly as a new one would.
    const limits =
      Option.isNone(family) || files === null
        ? Option.none<SkycotFamilyLimits.SkycotFamilyLimits["Service"]>()
        : Option.some(
            yield* SkycotFamilyLimits.makeAt(
              files.path.join(files.stateDir, SkycotFamilyLimits.ACTIVITY_FILE_NAME),
            ).pipe(
              Effect.provideService(FileSystem.FileSystem, files.fs),
              Effect.provideService(Path.Path, files.path),
              Effect.provideService(SkycotFamily.SkycotFamily, family.value),
            ),
          );
    const fallback = yield* makeFallback(inner, {
      getProviders: registry.value.getProviders,
      store,
      turnRuleFor: makeTurnRule({ family, limits }),
    });
    yield* fallback.start;
    return fallback.service;
  }),
);

/** The seam: `base` unchanged unless the SKYCOT policy is on. */
export function layerOrchestrator<E, R>(
  base: Layer.Layer<Orchestrator.OrchestratorV2, E, R>,
  options: { readonly enabled: boolean },
): Layer.Layer<Orchestrator.OrchestratorV2, E, R> {
  return options.enabled ? layerWrap.pipe(Layer.provide(base)) : base;
}
