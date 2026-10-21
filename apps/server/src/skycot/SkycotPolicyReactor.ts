// Answers the provider's approval requests for threads the SKYCOT policy governs: approves
// what no hard rule matches, leaves the rest pending for the person. See SkycotPolicy.ts for
// the design and the flag that gates both halves.
//
// It also closes the door Stop leaves open: the engine only cancels a run's pending asks
// once the provider has confirmed the interrupt, which can take a while, and until then a
// late click on a card is still accepted. The moment the person asks to stop, every pending
// ask of that run is answered `cancel` here, so nothing can be approved into a stopped run.

import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2RunStatus,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ProviderDriverKind,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { policyDecisionAnswers } from "@t3tools/skycot-rules/decision";
import {
  evaluateRequest,
  type RuleContext,
  type RuleEvaluation,
  type RuleRequest,
} from "@t3tools/skycot-rules/rules";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import { appliesToRuntimeMode, requestFacts } from "./SkycotPolicy.ts";

export type SkycotPolicyOutcome =
  | { readonly type: "skipped"; readonly reason: string }
  | { readonly type: "held"; readonly evaluation: RuleEvaluation }
  | { readonly type: "approved"; readonly evaluation: RuleEvaluation }
  /** Stop was pressed: these pending asks were answered `cancel` on the person's behalf. */
  | { readonly type: "cancelled"; readonly requestIds: ReadonlyArray<RuntimeRequestId> };

export class SkycotPolicyReactor extends Context.Service<
  SkycotPolicyReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Runs for every domain event; returns what it did so tests can assert on it. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<SkycotPolicyOutcome>;
  }
>()("t3/skycot/SkycotPolicyReactor") {}

const skipped = (reason: string): SkycotPolicyOutcome => ({ type: "skipped", reason });

const AUTO_KINDS: ReadonlySet<OrchestrationV2RuntimeRequest["kind"]> = new Set([
  "command",
  "file-change",
  "file-read",
  "permission",
  "mcp-elicitation",
]);

const SETTLED_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export function policyCommandId(threadId: ThreadId, requestId: RuntimeRequestId): CommandId {
  return CommandId.make(`server:skycot-policy:${threadId}:${requestId}`);
}

export function stopCommandId(threadId: ThreadId, requestId: RuntimeRequestId): CommandId {
  return CommandId.make(`server:skycot-stop:${threadId}:${requestId}`);
}

/** Only a push can be judged by branch, so only a push pays for the two git lookups. */
export function needsBranchContext(facts: RuleRequest): boolean {
  return (
    facts.kind === "command" &&
    facts.command !== undefined &&
    /\bgit\b[\s\S]*\bpush\b/.test(facts.command)
  );
}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const git = yield* GitVcsDriver.GitVcsDriver;
  // Optional so the layer's type is unchanged; server.ts provides it at the top.
  const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  const familyOn = Option.isNone(family) ? Effect.succeed(false) : family.value.isEnabled;

  /**
   * The branch the push would send and the branch everyone sees. A thread with a private
   * copy knows its branch; a plain folder asks git. Anything that fails stays null, and the
   * rules hold a bare push whose branch nobody knows.
   */
  const branchContextFor = Effect.fnUntraced(function* (
    thread: { readonly branch: string | null },
    projectRoot: string | null,
  ): Generator<
    Effect.Effect<unknown, never>,
    Pick<RuleContext, "currentBranch" | "defaultBranch">
  > {
    if (projectRoot === null) return { currentBranch: thread.branch, defaultBranch: null };
    const currentBranch =
      thread.branch ??
      (yield* git.statusDetailsLocal(projectRoot).pipe(
        Effect.map((details) => details.branch),
        Effect.orElseSucceed(() => null),
      ));
    const defaultBranch = yield* git.resolvePrimaryRemoteName(projectRoot).pipe(
      Effect.flatMap((remote) => git.resolveDefaultBranchName(projectRoot, remote)),
      Effect.orElseSucceed(() => null),
    );
    return { currentBranch, defaultBranch };
  });

  const toolCallFor = Effect.fnUntraced(function* (
    threadId: ThreadId,
    approval: Extract<OrchestrationV2TurnItem, { type: "approval_request" }>,
    driver: ProviderDriverKind | undefined,
  ) {
    const ref = approval.nativeItemRef;
    const itemDriver = ref?.driver ?? driver;
    if (ref === null || ref.nativeId === null || itemDriver === undefined) return null;
    return yield* projections.getTurnItem({
      threadId,
      itemId: IdAllocator.derive.turnItemFromProviderItem({
        driver: itemDriver,
        nativeItemId: ref.nativeId,
      }),
    });
  });

  const projectRootFor = Effect.fnUntraced(function* (thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) {
    if (thread.worktreePath !== null) return thread.worktreePath;
    const project = yield* projects.get(thread.projectId);
    return Option.isSome(project) ? project.value.workspaceRoot : null;
  });

  /** False once the person asked to stop the run, or the run has already settled. */
  const runStillActive = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const records = yield* projections.getThreadRecords(threadId, ["runs", "turnItems"], {
      runIds: [runId],
      turnItemRunIds: [runId],
      turnItemTypes: ["run_interrupt_request"],
    });
    if (records.turnItems.length > 0) return false;
    const run = records.runs.find((candidate) => candidate.id === runId);
    return run === undefined || !SETTLED_RUN_STATUSES.has(run.status);
  });

  const decide = Effect.fn("SkycotPolicyReactor.decide")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: RuntimeRequestId;
    readonly driver: ProviderDriverKind | undefined;
  }) {
    // A child's assistant asks for everything; nothing is approved on their behalf.
    if (yield* familyOn) return skipped("family profile is on");
    const thread = yield* projections.getThread(input.threadId);
    if (!appliesToRuntimeMode(thread.runtimeMode)) return skipped("runtime mode not governed");
    if (thread.archivedAt !== null || thread.deletedAt !== null) return skipped("thread closed");
    const request = yield* projections.getRuntimeRequest(input.threadId, input.requestId);
    if (request === undefined) return skipped("request missing");
    if (request.status !== "pending") return skipped(`request ${request.status}`);
    if (request.responseCapability.type !== "live") return skipped("request not live");
    if (!AUTO_KINDS.has(request.kind)) return skipped(`kind ${request.kind} is the person's`);
    const approval = yield* projections.getTurnItem({
      threadId: input.threadId,
      itemId: IdAllocator.derive.approvalTurnItem({ requestId: input.requestId }),
    });
    if (approval === null || approval.type !== "approval_request") {
      // The turn item lands in the same batch; its own event re-enters here.
      return skipped("approval item not stored yet");
    }
    if (approval.runId !== null && !(yield* runStillActive(input.threadId, approval.runId))) {
      // Stop was pressed (or the run ended): never approve into a run that is going away.
      return skipped("run no longer active");
    }
    const toolCall = yield* toolCallFor(input.threadId, approval, input.driver);
    const facts = requestFacts(approval, toolCall, input.driver);
    if (facts === null) return skipped("request kind unknown");
    const projectRoot = yield* projectRootFor(thread);
    const branches = needsBranchContext(facts) ? yield* branchContextFor(thread, projectRoot) : {};
    const evaluation = evaluateRequest(facts, { projectRoot, ...branches });
    if (evaluation.decision === "hold") {
      yield* Effect.logInfo("skycot-policy.held", {
        threadId: input.threadId,
        requestId: input.requestId,
        rules: evaluation.matches.map((match) => match.rule.id),
      });
      return { type: "held", evaluation } satisfies SkycotPolicyOutcome;
    }
    yield* engine.dispatch({
      type: "runtime-request.respond",
      commandId: policyCommandId(input.threadId, input.requestId),
      threadId: input.threadId,
      requestId: input.requestId,
      decision: "accept",
      answers: policyDecisionAnswers(evaluation),
    });
    yield* Effect.logInfo("skycot-policy.approved", {
      threadId: input.threadId,
      requestId: input.requestId,
      kind: request.kind,
    });
    return { type: "approved", evaluation } satisfies SkycotPolicyOutcome;
  });

  // Stop pressed: answer every pending ask of that run with `cancel` now, before the
  // provider has even acknowledged the interrupt.
  const cancelPendingAsks = Effect.fn("SkycotPolicyReactor.cancelPendingAsks")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) {
    const recovery = yield* projections.getRuntimeRecoveryProjection(input.threadId);
    const askedByRun = new Set(
      recovery.turnItems.flatMap((item) =>
        item.runId === input.runId &&
        (item.type === "approval_request" || item.type === "user_input_request")
          ? [item.requestId]
          : [],
      ),
    );
    const nodesOfRun = new Set(
      recovery.nodes.filter((node) => node.runId === input.runId).map((node) => node.id),
    );
    const pending = recovery.runtimeRequests.filter(
      (request) =>
        request.status === "pending" &&
        request.responseCapability.type === "live" &&
        (askedByRun.has(request.id) || nodesOfRun.has(request.nodeId)),
    );
    const cancelled: Array<RuntimeRequestId> = [];
    for (const request of pending) {
      const sent = yield* engine
        .dispatch({
          type: "runtime-request.respond",
          commandId: stopCommandId(input.threadId, request.id),
          threadId: input.threadId,
          requestId: request.id,
          decision: "cancel",
        })
        .pipe(
          Effect.as(true),
          // Already answered or already cancelled by the engine: nothing to do.
          Effect.catchCause((cause) =>
            Effect.logDebug("skycot-stop.respond-failed", {
              threadId: input.threadId,
              requestId: request.id,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (sent) cancelled.push(request.id);
    }
    if (cancelled.length > 0) {
      yield* Effect.logInfo("skycot-stop.cancelled-pending-asks", {
        threadId: input.threadId,
        runId: input.runId,
        requestIds: cancelled,
      });
    }
    return { type: "cancelled", requestIds: cancelled } satisfies SkycotPolicyOutcome;
  });

  // Runs for every domain event; most events return before any work is needed. Both the
  // request event and the approval item's event are handled because the adapters emit them
  // in the same batch and either may be stored first.
  const handle: SkycotPolicyReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "run_interrupt_request" &&
        event.payload.runId !== null
      ) {
        return yield* cancelPendingAsks({ threadId: event.threadId, runId: event.payload.runId });
      }
      if (event.type === "runtime-request.updated") {
        if (event.payload.status !== "pending") return skipped("not pending");
        return yield* decide({
          threadId: event.threadId,
          requestId: event.payload.id,
          driver: event.driver,
        });
      }
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "approval_request" &&
        event.payload.status === "waiting"
      ) {
        return yield* decide({
          threadId: event.threadId,
          requestId: event.payload.requestId,
          driver: event.driver,
        });
      }
      return skipped("not an approval event");
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot policy could not decide a runtime request", {
            threadId: event.threadId,
            cause,
          }).pipe(Effect.as(skipped("failed"))),
        ),
      ),
  );

  const start: SkycotPolicyReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        handle(event).pipe(Effect.asVoid),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot policy event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies SkycotPolicyReactor["Service"];
});

/** Disabled: never subscribes, never dispatches. */
const layerDisabled = Layer.succeed(
  SkycotPolicyReactor,
  SkycotPolicyReactor.of({
    start: () => Effect.void,
    handle: () => Effect.succeed(skipped("policy disabled")),
  }),
);

export function layer(options: {
  readonly enabled: boolean;
}): Layer.Layer<
  SkycotPolicyReactor,
  never,
  | Orchestrator.OrchestratorV2
  | ProjectionStore.ProjectionStoreV2
  | ProjectStore.ProjectStoreV2
  | GitVcsDriver.GitVcsDriver
> {
  return options.enabled ? Layer.effect(SkycotPolicyReactor, make) : layerDisabled;
}
