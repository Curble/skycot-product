// nondev-seam: skycot-iphone-q39-timeline
// nondev-seam: skycot-iphone-q50-timeline
/**
 * A conversation as SKYCOT's plain cards: what the child said, what Sam said, the plan (Build
 * it / Change the plan), Ask a grown-up, What changed (Undo), and a working line. The words
 * come from the plain client's pure modules (apps/nondev/src/plain, features/family/cards);
 * this file only orders the engine's items. Developer detail (commands, diffs, reasoning) is
 * never shown on the phone.
 */
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

import { describeChanges, fromCheckpointFiles } from "../../../nondev/src/plain/changes";
import {
  describeRuntimeRequest,
  toolCallInputFor,
  type ApprovalCard,
} from "../../../nondev/src/plain/approvals";
import {
  familyCard,
  familyHoldFor,
  toolItemTypeFor,
  type FamilyCard,
} from "../../../nondev/src/features/family/cards";
import type { Checkpoint, ThreadProjection, TurnItem } from "./types";
import { visibleMessageText } from "./displayText";
import { kidSafeText } from "../../../nondev/src/features/conversation/kidSafeText";
import { childApprovalSentence } from "../../../nondev/src/plain/approvals";

export type TimelineEntry =
  | { readonly kind: "me"; readonly id: string; readonly text: string; readonly at: string }
  | {
      readonly kind: "crew";
      readonly id: string;
      readonly text: string;
      readonly streaming: boolean;
      readonly at: string;
    }
  | {
      readonly kind: "plan";
      readonly id: string;
      readonly planId: string;
      readonly markdown: string;
      readonly state: "writing" | "ready" | "building" | "done" | "replaced";
    }
  | {
      readonly kind: "ask";
      readonly id: string;
      readonly requestId: string;
      /** `grownUp` is the rule that makes it a grown-up's call; null: the child may say yes. */
      readonly card: FamilyCard;
      readonly state: "waiting" | "allowed" | "declined" | "ended";
    }
  | {
      readonly kind: "question";
      readonly id: string;
      readonly requestId: string;
      readonly questionId: string;
      readonly question: string;
      readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
      readonly answer: string | null;
      readonly state: "waiting" | "answered" | "ended";
    }
  | {
      readonly kind: "changed";
      readonly id: string;
      readonly headline: string;
      readonly lines: ReadonlyArray<string>;
      readonly fileCount: number;
      /** Where Undo goes back to; null when there's no restore point before it. */
      readonly undo: { readonly scopeId: string; readonly checkpointId: string } | null;
      readonly undone: boolean;
      readonly kidSummary: boolean;
    }
  | {
      readonly kind: "oops";
      readonly id: string;
      readonly text: string;
      readonly retryText: string | null;
      readonly isRest: boolean;
      readonly restUntil: string | null;
    };

const LIVE_RUN = new Set(["preparing", "starting", "running", "waiting"]);

export function planDisplayState(
  status: "draft" | "active" | "completed" | "superseded" | undefined,
  working: boolean,
  waitingForAnswer: boolean,
): "writing" | "ready" | "building" | "done" | "replaced" {
  if (status === "superseded") return "replaced";
  if (working && !waitingForAnswer) return "building";
  if (status === "completed") return "done";
  return "ready";
}

export function claimQuestionAnswer(answered: Set<string>, questionId: string): boolean {
  if (answered.has(questionId)) return false;
  answered.add(questionId);
  return true;
}

export function isWorking(projection: ThreadProjection): boolean {
  return projection.runs.some((run) => LIVE_RUN.has(run.status));
}

function findBefore(projection: ThreadProjection, checkpoint: Checkpoint): Checkpoint | null {
  // As the plain client's review/turnReview.ts findBefore, over the engine's JSON.
  if (checkpoint.parentCheckpointId !== null) {
    const parent = projection.checkpoints.find((c) => c.id === checkpoint.parentCheckpointId);
    if (parent) return parent;
  }
  return (
    projection.checkpoints.find(
      (c) =>
        c.scopeId === checkpoint.scopeId &&
        c.ordinalWithinScope === checkpoint.ordinalWithinScope - 1,
    ) ?? null
  );
}

export interface TimelineContext {
  readonly projectRoot: string | null;
  readonly assistantName: string;
  readonly childView?: boolean;
}

export function buildTimeline(
  projection: ThreadProjection,
  context: TimelineContext,
): Array<TimelineEntry> {
  const items = [...projection.visibleTurnItems]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.item as TurnItem);
  const decodedItems = projection.turnItems as unknown as ReadonlyArray<OrchestrationV2TurnItem>;
  const rolledBack = new Set(
    projection.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const working = isWorking(projection);
  const waitingForAnswer = projection.runtimeRequests.some(
    (request) =>
      request.status === "pending" &&
      items.some((item) => item.type === "user_input_request" && item.requestId === request.id),
  );
  const out: Array<TimelineEntry> = [];

  for (const [index, item] of items.entries()) {
    switch (item.type) {
      case "user_message":
        if (visibleMessageText(item.text).length > 0) {
          out.push({
            kind: "me",
            id: item.id,
            text: visibleMessageText(item.text),
            at: String(item.updatedAt),
          });
        }
        break;
      case "assistant_message":
        if (visibleMessageText(item.text).length > 0) {
          out.push({
            kind: "crew",
            id: item.id,
            text: context.childView
              ? kidSafeText(visibleMessageText(item.text))
              : visibleMessageText(item.text),
            streaming: item.streaming,
            at: String(item.updatedAt),
          });
        }
        break;
      case "proposed_plan": {
        const plan = projection.plans.find((candidate) => candidate.id === item.planId);
        const state = item.streaming
          ? "writing"
          : planDisplayState(plan?.status, working, waitingForAnswer);
        out.push({
          kind: "plan",
          id: item.id,
          planId: item.planId,
          markdown: item.markdown,
          state,
        });
        break;
      }
      case "approval_request": {
        const request = projection.runtimeRequests.find((r) => r.id === item.requestId);
        const decoded = item as unknown as Extract<
          OrchestrationV2TurnItem,
          { type: "approval_request" }
        >;
        const toolCallInput = toolCallInputFor(decoded, decodedItems);
        const base = describeRuntimeRequest(decoded, {
          assistantName: context.assistantName,
          ...(context.projectRoot === null ? {} : { projectRoot: context.projectRoot }),
          ...(request ? { responseCapability: request.responseCapability.type } : {}),
          ...(toolCallInput === undefined ? {} : { toolCallInput }),
        });
        const reason = familyHoldFor(decoded, {
          projectRoot: context.projectRoot,
          projectFolder: context.projectRoot,
          toolCallInput,
          toolItemType: toolItemTypeFor(decoded, decodedItems),
        });
        const card = familyCard(base, reason);
        const state =
          request?.status === "pending"
            ? working
              ? "waiting"
              : "ended"
            : request?.decision === "decline" || request?.decision === "cancel"
              ? "declined"
              : request?.status === "resolved"
                ? "allowed"
                : "ended";
        if (
          context.childView &&
          card.grownUp === null &&
          request?.status === "resolved" &&
          request.decision === "accept"
        )
          break;
        out.push({
          kind: "ask",
          id: item.id,
          requestId: item.requestId,
          card:
            context.childView && card.grownUp !== null
              ? { ...card, whatItWants: childApprovalSentence(card, "Sam") }
              : card,
          state,
        });
        break;
      }
      case "user_input_request": {
        const request = projection.runtimeRequests.find((r) => r.id === item.requestId);
        for (const question of item.questions) {
          const answer = request?.answers?.[question.id];
          out.push({
            kind: "question",
            id: `${item.id}:${question.id}`,
            requestId: item.requestId,
            questionId: question.id,
            question: question.question,
            options: question.options.map((option) => ({
              label: option.label,
              value: option.value ?? option.label,
            })),
            answer: typeof answer === "string" && answer.trim().length > 0 ? answer : null,
            state:
              request?.status === "resolved"
                ? "answered"
                : request?.status === "pending"
                  ? "waiting"
                  : "ended",
          });
        }
        break;
      }
      case "checkpoint": {
        if (item.files.length === 0) break;
        const checkpoint = projection.checkpoints.find((c) => c.id === item.checkpointId);
        const before = checkpoint ? findBefore(projection, checkpoint) : null;
        const summary = describeChanges(fromCheckpointFiles(item.files as never));
        const kidSummary = context.childView === true;
        out.push({
          kind: "changed",
          id: item.id,
          headline: kidSummary ? "Sam made your page." : summary.summary,
          lines: kidSummary
            ? ["Your page is ready to play."]
            : summary.groups.flatMap((group) => group.files.map((file) => file.line)).slice(0, 6),
          fileCount: item.files.length,
          undo:
            before !== null && before.status === "ready"
              ? { scopeId: before.scopeId, checkpointId: before.id }
              : null,
          undone: checkpoint?.runId != null && rolledBack.has(checkpoint.runId),
          kidSummary,
        });
        break;
      }
      case "error":
        if (!items.slice(index + 1).some((later) => later.type === "user_message")) {
          const previousMessage = items
            .slice(0, index)
            .findLast((earlier) => earlier.type === "user_message");
          const reason = {
            usage_limit: "Sam has reached a limit for now.",
            provider_error: "Sam had trouble answering.",
            transport_error: "The Mac lost its connection for a moment.",
            permission_error: "The Mac needs a grown-up to check something.",
            validation_error: "That message needs a small change.",
            unknown: "Sam couldn't finish that message.",
          }[item.failure.class];
          out.push({
            kind: "oops",
            id: item.id,
            text: item.failure.class === "usage_limit" ? "Sam needs a short rest." : reason,
            retryText: previousMessage?.type === "user_message" ? previousMessage.text : null,
            isRest: item.failure.class === "usage_limit",
            restUntil: item.failure.class === "usage_limit" ? (item.failure.resetAt ?? null) : null,
          });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

export type { ApprovalCard };
