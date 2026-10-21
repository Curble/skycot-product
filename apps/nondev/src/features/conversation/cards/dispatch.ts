// Sends a card's decision down the same command paths apps/web uses. The plain
// layer decides *what* the buttons say and carry; this module only adds
// transport details (thread, mode) and turns failures into one calm sentence.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  PlanId,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import type { ApprovalDecisionPayload } from "../../../plain/approvals";
import { serverEnvironment } from "../../../state/server";
import { threadEnvironment } from "../../../state/threads";

export interface DispatchExtras {
  /** For "runtime-request.respond" with answers: the filled-in form. */
  readonly answers?: ProviderUserInputAnswers;
  /** For "secretRequest.answer" save: the value, straight from the password field. */
  readonly secret?: string;
  /** For "send-message": the text the user typed (or the chip's canned line). */
  readonly text?: string;
  /** For "send-message" that approves a plan: start the real work from it. */
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
  // The failure cause can echo the request; keep it out of the console.
  const answerSecret = useAtomCommand(serverEnvironment.answerSecretRequest, {
    reportFailure: false,
    reportDefect: false,
  });

  return async (payload, extras = {}) => {
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
          const text = (extras.text ?? payload.text).trim();
          if (text.length === 0 || shell === null) return null;
          return startTurn({
            environmentId,
            input: {
              threadId,
              message: { messageId: newMessageId(), role: "user", text, attachments: [] },
              modelSelection: shell.modelSelection,
              runtimeMode: shell.runtimeMode,
              interactionMode: extras.plan?.interactionMode ?? shell.interactionMode,
              ...(extras.plan && extras.plan.interactionMode === "default"
                ? { sourceProposedPlan: { threadId, planId: extras.plan.planId } }
                : {}),
            },
          });
        }
      }
    })();
    if (outcome === null || outcome === undefined) return null;
    return outcome._tag === "Failure" ? calmFailure(squashAtomCommandFailure(outcome)) : null;
  };
}
