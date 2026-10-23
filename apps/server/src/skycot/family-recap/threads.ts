// One conversation as the recap and the fridge read it: its user messages, the checkpoints
// a person would see (one per turn, plus manual saves), how each run ended, and where its
// files are. Read straight from the projections, so nothing new is stored for either.
import type { ProjectId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import type * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { isQuestionsSpace, QUESTIONS_LABEL } from "@t3tools/skycot-rules/questions";

import type { RecapThreadInput } from "./recap.ts";

const ROOT_SCOPES: ReadonlySet<string> = new Set(["root_run", "manual"]);

export interface LoadedThread extends Omit<RecapThreadInput, "heldAt"> {
  readonly deleted: boolean;
  readonly updatedAt: number;
  /** Approval cards in this thread, for the caller to judge (the recap counts held ones). */
  readonly approvals: ReadonlyArray<{ readonly requestId: RuntimeRequestId; readonly at: number }>;
}

/** Null when the engine no longer has the conversation. */
export const loadThread = Effect.fn("SkycotFamilyRecap.loadThread")(function* (
  projections: ProjectionStore.ProjectionStoreV2["Service"],
  projects: ProjectStore.ProjectStoreV2["Service"],
  threadId: ThreadId,
  options: {
    readonly messages: boolean;
    /** SKYCOT's Questions space, so a question is labelled and counted as one. */
    readonly questionsRoot?: string | null;
  },
) {
  const records = yield* projections
    .getThreadRecords(
      threadId,
      options.messages
        ? ["messages", "checkpoints", "checkpointScopes", "runs", "turnItems"]
        : ["checkpoints", "checkpointScopes", "runs"],
      options.messages
        ? { messageRoles: ["user"], turnItemTypes: ["approval_request"] }
        : undefined,
    )
    .pipe(Effect.orElseSucceed(() => null));
  if (records === null) return null;
  const { thread } = records;
  const own = yield* projects
    .get(thread.projectId as ProjectId)
    .pipe(Effect.orElseSucceed(() => Option.none()));
  const inQuestions =
    Option.isSome(own) && isQuestionsSpace(own.value.workspaceRoot, options.questionsRoot);
  // "Make this a project" turns the question's own folder into a project; the conversation
  // stays the engine's Scratch thread but belongs with that project from then on.
  const adopted =
    inQuestions && thread.worktreePath !== null
      ? yield* projects
          .findActiveByWorkspaceRoot(thread.worktreePath)
          .pipe(Effect.orElseSucceed(() => Option.none()))
      : Option.none();
  const project = Option.isSome(adopted) ? adopted : own;
  const question = inQuestions && Option.isNone(adopted);
  const roots = new Set(
    records.checkpointScopes
      .filter((scope) => ROOT_SCOPES.has(scope.kind))
      .map((scope) => scope.id),
  );
  const fields = records as Partial<
    ProjectionStore.ProjectionRecords<"messages" | "turnItems">
  > as {
    readonly messages?: ProjectionStore.ProjectionRecords<"messages">["messages"];
    readonly turnItems?: ProjectionStore.ProjectionRecords<"turnItems">["turnItems"];
  };
  return {
    threadId: thread.id,
    projectId: Option.isSome(project) ? project.value.projectId : thread.projectId,
    projectTitle: question ? QUESTIONS_LABEL : Option.isSome(project) ? project.value.title : null,
    question,
    title: thread.title,
    createdAt: DateTime.toEpochMillis(thread.createdAt),
    updatedAt: DateTime.toEpochMillis(thread.updatedAt),
    deleted: thread.deletedAt !== null,
    cwd: thread.worktreePath ?? (Option.isSome(project) ? project.value.workspaceRoot : null),
    messages: (fields.messages ?? []).map((message) => ({
      id: message.id,
      createdBy: message.createdBy,
      text: message.text,
      createdAt: DateTime.toEpochMillis(message.createdAt),
    })),
    checkpoints: records.checkpoints
      .filter((checkpoint) => roots.has(checkpoint.scopeId))
      .map((checkpoint) => ({
        id: checkpoint.id,
        runId: checkpoint.runId,
        capturedAt: DateTime.toEpochMillis(checkpoint.capturedAt),
        files: checkpoint.files,
      })),
    runs: records.runs.map((run) => ({ id: run.id, status: run.status })),
    approvals: (fields.turnItems ?? []).flatMap((item) =>
      item.type === "approval_request"
        ? [
            {
              requestId: item.requestId,
              at: DateTime.toEpochMillis(item.startedAt ?? item.updatedAt),
            },
          ]
        : [],
    ),
  } satisfies LoadedThread;
});
