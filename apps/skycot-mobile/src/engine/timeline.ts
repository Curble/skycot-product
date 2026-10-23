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
      readonly kind: "changed";
      readonly id: string;
      readonly headline: string;
      readonly lines: ReadonlyArray<string>;
      readonly fileCount: number;
      /** Where Undo goes back to; null when there's no restore point before it. */
      readonly undo: { readonly scopeId: string; readonly checkpointId: string } | null;
      readonly undone: boolean;
    }
  | { readonly kind: "oops"; readonly id: string; readonly text: string };

const LIVE_RUN = new Set(["preparing", "starting", "running", "waiting"]);

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
  const out: Array<TimelineEntry> = [];

  for (const item of items) {
    switch (item.type) {
      case "user_message":
        if (item.text.trim().length > 0) {
          out.push({ kind: "me", id: item.id, text: item.text, at: String(item.updatedAt) });
        }
        break;
      case "assistant_message":
        if (item.text.trim().length > 0) {
          out.push({
            kind: "crew",
            id: item.id,
            text: item.text,
            streaming: item.streaming,
            at: String(item.updatedAt),
          });
        }
        break;
      case "proposed_plan": {
        const plan = projection.plans.find((candidate) => candidate.id === item.planId);
        const state = item.streaming
          ? "writing"
          : plan?.status === "superseded"
            ? "replaced"
            : plan?.status === "completed"
              ? "done"
              : plan?.status === "active" && working
                ? "building"
                : "ready";
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
        const decoded = item as unknown as Extract<
          OrchestrationV2TurnItem,
          { type: "approval_request" }
        >;
        const request = projection.runtimeRequests.find((r) => r.id === item.requestId);
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
        out.push({ kind: "ask", id: item.id, requestId: item.requestId, card, state });
        break;
      }
      case "checkpoint": {
        if (item.files.length === 0) break;
        const checkpoint = projection.checkpoints.find((c) => c.id === item.checkpointId);
        const before = checkpoint ? findBefore(projection, checkpoint) : null;
        const summary = describeChanges(fromCheckpointFiles(item.files as never));
        out.push({
          kind: "changed",
          id: item.id,
          headline: summary.summary,
          lines: summary.groups
            .flatMap((group) => group.files.map((file) => file.line))
            .slice(0, 6),
          fileCount: item.files.length,
          undo:
            before !== null && before.status === "ready"
              ? { scopeId: before.scopeId, checkpointId: before.id }
              : null,
          undone: checkpoint?.runId != null && rolledBack.has(checkpoint.runId),
        });
        break;
      }
      case "error":
        out.push({
          kind: "oops",
          id: item.id,
          text: "Something went wrong on the Mac. Try asking again in a moment.",
        });
        break;
      default:
        break;
    }
  }
  return out;
}

export type { ApprovalCard };
