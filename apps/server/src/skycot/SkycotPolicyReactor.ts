// Answers the provider's approval requests for threads the SKYCOT policy governs: approves
// what no hard rule matches, leaves the rest pending for the person. See SkycotPolicy.ts for
// the design and the flag that gates both halves.

import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ProviderDriverKind,
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
import { evaluateRequest, type RuleEvaluation } from "@t3tools/skycot-rules/rules";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { forkParked } from "../serverActivation.ts";
import { appliesToRuntimeMode, requestFacts } from "./SkycotPolicy.ts";

export type SkycotPolicyOutcome =
  | { readonly type: "skipped"; readonly reason: string }
  | { readonly type: "held"; readonly evaluation: RuleEvaluation }
  | { readonly type: "approved"; readonly evaluation: RuleEvaluation };

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

export function policyCommandId(threadId: ThreadId, requestId: RuntimeRequestId): CommandId {
  return CommandId.make(`server:skycot-policy:${threadId}:${requestId}`);
}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;

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

  const decide = Effect.fn("SkycotPolicyReactor.decide")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: RuntimeRequestId;
    readonly driver: ProviderDriverKind | undefined;
  }) {
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
    const toolCall = yield* toolCallFor(input.threadId, approval, input.driver);
    const facts = requestFacts(approval, toolCall);
    if (facts === null) return skipped("request kind unknown");
    const projectRoot = yield* projectRootFor(thread);
    const evaluation = evaluateRequest(facts, { projectRoot });
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

  // Runs for every domain event; most events return before any work is needed. Both the
  // request event and the approval item's event are handled because the adapters emit them
  // in the same batch and either may be stored first.
  const handle: SkycotPolicyReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
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
  Orchestrator.OrchestratorV2 | ProjectionStore.ProjectionStoreV2 | ProjectStore.ProjectStoreV2
> {
  return options.enabled ? Layer.effect(SkycotPolicyReactor, make) : layerDisabled;
}
