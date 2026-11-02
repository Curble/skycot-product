// Sends a card's decision down the same command paths apps/web uses. The plain
// layer decides *what* the buttons say and carry; this module only adds
// transport details (thread, mode) and turns failures into one calm sentence.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  PlanId,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import { readExplainMarker, withExplainMarker } from "@t3tools/skycot-rules/explain";

import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import type { ApprovalDecisionPayload } from "../../../plain/approvals";
import { requestMode, usePlanFirst } from "../../compose/planFirst";
import { useEnsureInteractionMode } from "../../compose/turnMode";
import { useExplainMode } from "../../explain/explainMode";
import { isFamilyRefusal } from "../../family/cards";
import { beginSend, buildItHeldBackNote, buildItHold } from "../sendsInFlight";
import { useCrew } from "../../../themes/useCrew";
import { useFamily } from "../../family/FamilyProvider";
import { noteDispatchMode } from "../../rewind/rewind";
import { useChildView } from "../../../app/useChildView";
import { shieldProblem } from "../../shield/shield";
import { serverEnvironment } from "../../../state/server";
import { threadEnvironment } from "../../../state/threads";

export interface DispatchExtras {
  /** For "runtime-request.respond" with answers: the filled-in form. */
  readonly answers?: ProviderUserInputAnswers;
  /** For "secretRequest.answer" save: the value, straight from the password field. */
  readonly secret?: string;
  /** For "send-message": the text the user typed (or the chip's canned line). */
  readonly text?: string;
  /**
   * For "send-message" that approves a plan ("Build it"): start the real work from it, in
   * `interactionMode` ("default" builds). Other messages follow plan first.
   */
  readonly plan?: { readonly planId: PlanId; readonly interactionMode: ProviderInteractionMode };
  /** For "run.interrupt". */
  readonly runId?: RunId | null;
}

export type DispatchDecision = (
  payload: ApprovalDecisionPayload,
  extras?: DispatchExtras,
) => Promise<string | null>;

export function calmFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  // The engine's Family-profile refusal is already one calm sentence; the card acts on it.
  if (isFamilyRefusal(message)) return message;
  if (/scope|permission|unauthori/i.test(message))
    return "This connection isn't allowed to answer for you.";
  if (/already|resolved|not found|no longer/i.test(message))
    return "This was already answered, maybe from another device.";
  if (/stopped|gone|not_resumable|exited/i.test(message))
    return "The assistant has stopped, so this can't be answered any more.";
  return "That didn't go through. Check your Mac is awake and try again.";
}

/**
 * Returns a function that performs one card decision and resolves to null on
 * success or a plain-English problem line.
 */
export function useDecisionDispatcher({
  environmentId,
  threadId,
  shell,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
}): DispatchDecision {
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const ensureMode = useEnsureInteractionMode();
  const planFirst = usePlanFirst();
  // The failure cause can echo the request; keep it out of the console.
  const family = useFamily();
  const childView = useChildView();
  const crew = useCrew();
  const answerSecret = useAtomCommand(serverEnvironment.answerSecretRequest, {
    reportFailure: false,
    reportDefect: false,
  });

  const [explainOn] = useExplainMode(threadId, family.enabled);

  return async (payload, extras = {}) => {
    if (payload.type === "send-message" && family.enabled) {
      // A short reply gets the shield's sentence instead of its card; the engine would hide
      // the detail anyway, so the child fixes it here first.
      const problem = shieldProblem(readExplainMarker(extras.text ?? payload.text).text);
      if (problem !== null) return problem;
    }
    const outcome = await (async () => {
      switch (payload.type) {
        case "runtime-request.respond":
          if ("decision" in payload) {
            return respondToApproval({
              environmentId,
              input: { threadId, requestId: payload.requestId, decision: payload.decision },
            });
          }
          return respondToUserInput({
            environmentId,
            input: { threadId, requestId: payload.requestId, answers: extras.answers ?? {} },
          });
        case "thread.user-input.dismiss":
          return dismissUserInput({
            environmentId,
            input: { threadId, requestId: payload.requestId },
          });
        case "secretRequest.answer": {
          const answer =
            payload.answer.type === "save"
              ? ({ type: "save", secret: (extras.secret ?? "").trim() } as const)
              : ({ type: "decline" } as const);
          if (answer.type === "save" && answer.secret.length === 0) return null;
          // The engine refuses a child's save; ask first so the parent can say yes here.
          if (answer.type === "save" && !(await family.requireParentCode("saveSecret"))) {
            return null;
          }
          return answerSecret({
            environmentId,
            input: { threadId, turnItemId: payload.turnItemId, answer },
          });
        }
        case "run.interrupt":
          return interruptTurn({
            environmentId,
            input: { threadId, ...(extras.runId ? { runId: extras.runId } : {}) },
          });
        case "send-message": {
          const typed = (extras.text ?? payload.text).trim();
          if (typed.length === 0 || shell === null) return null;
          // A Build it is tied to one plan: never lined up behind another message, where it
          // could run after a newer plan was written. The child presses it again on the newest plan.
          const hold =
            extras.plan === undefined
              ? null
              : buildItHold(threadId, threadRuntimeIsActive(shell.runtime));
          if (hold !== null) return buildItHeldBackNote(hold, crew.builder.name);
          const endSend = beginSend(threadId);
          let accepted = false;
          try {
            const text =
              readExplainMarker(typed).choice === null
                ? withExplainMarker(typed, explainOn, family.enabled)
                : typed;
            // The engine runs a follow-up in the conversation's stored mode, so set it first:
            // "Build it" builds; any other new request plans while plan first is on.
            const interactionMode =
              extras.plan?.interactionMode ??
              (threadRuntimeIsActive(shell.runtime)
                ? shell.interactionMode
                : requestMode(planFirst));
            const modeProblem = await ensureMode({
              environmentId,
              threadId,
              current: shell.interactionMode,
              wanted: interactionMode,
            });
            if (modeProblem !== null) return calmFailure(modeProblem);
            const started = await startTurn({
              environmentId,
              input: {
                threadId,
                message: { messageId: newMessageId(), role: "user", text, attachments: [] },
                modelSelection: shell.modelSelection,
                runtimeMode: shell.runtimeMode,
                interactionMode,
                // Any other child message lines up (Take back works); Build it starts as usual.
                ...(extras.plan === undefined && noteDispatchMode(childView) !== undefined
                  ? { dispatchMode: "queue" as const }
                  : {}),
                ...(extras.plan && extras.plan.interactionMode === "default"
                  ? { sourceProposedPlan: { threadId, planId: extras.plan.planId } }
                  : {}),
              },
            });
            accepted = started._tag !== "Failure";
            return started;
          } finally {
            endSend(accepted);
          }
        }
      }
    })();
    if (outcome === null || outcome === undefined) return null;
    // Already one plain sentence (the mode switch before a message failed).
    if (typeof outcome === "string") return outcome;
    return outcome._tag === "Failure" ? calmFailure(squashAtomCommandFailure(outcome)) : null;
  };
}
