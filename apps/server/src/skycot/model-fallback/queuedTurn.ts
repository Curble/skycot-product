// nondev-seam: skycot-policy-files
// The engine's one question to the model fallback when it starts a message that waited in the
// queue: which model should this turn start on? Upstream starts it on the model stored with it
// when it was queued; when that model is resting (the turn in front of it hit the limit), every
// queued message failed once before the fallback carried it on. The engine asks here instead, so
// a queued message meets the same before-turn judge as one sent to an idle conversation.
//
// The engine reads this service with `Effect.serviceOption` (seam skycot-model-fallback-queue in
// Orchestrator.ts): without it, or until the fallback registers its judge, the answer is always
// the engine's own, so upstream behaviour is unchanged. The service is shared by the engine and
// the fallback that wraps it (`SkycotModelFallback.layerOrchestrator`), which is built after the
// engine; hence the registration rather than a plain dependency.

import type {
  ModelSelection,
  OrchestrationV2ConversationMessage,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

export interface QueuedTurnInput {
  readonly projection: Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "turnItems">;
  /** The queued run as stored. */
  readonly run: OrchestrationV2Run;
  /** Its message; undefined when the projection lacks it (the engine then refuses the start). */
  readonly message: OrchestrationV2ConversationMessage | undefined;
  /** The model the engine would start it on. */
  readonly modelSelection: ModelSelection;
}

/** Never fails: on any trouble the answer is `input.modelSelection`. */
export type QueuedTurnJudge = (input: QueuedTurnInput) => Effect.Effect<ModelSelection>;

export class SkycotQueuedTurnModel extends Context.Service<
  SkycotQueuedTurnModel,
  {
    readonly choose: QueuedTurnJudge;
    /** The fallback registers its judge once it is built. */
    readonly register: (judge: QueuedTurnJudge) => Effect.Effect<void>;
  }
>()("t3/skycot/model-fallback/queuedTurn/SkycotQueuedTurnModel") {}

export const layer = Layer.effect(
  SkycotQueuedTurnModel,
  Effect.gen(function* () {
    const judge = yield* Ref.make<QueuedTurnJudge | null>(null);
    return SkycotQueuedTurnModel.of({
      choose: (input) =>
        Ref.get(judge).pipe(
          Effect.flatMap((current) =>
            current === null ? Effect.succeed(input.modelSelection) : current(input),
          ),
          Effect.catchCause(() => Effect.succeed(input.modelSelection)),
        ),
      register: (next) => Ref.set(judge, next),
    });
  }),
);

/** For the engine: the service's judge, or the engine's own answer when it is absent. */
export const queuedTurnModel =
  (service: Option.Option<SkycotQueuedTurnModel["Service"]>): QueuedTurnJudge =>
  (input) =>
    Option.isNone(service) ? Effect.succeed(input.modelSelection) : service.value.choose(input);
