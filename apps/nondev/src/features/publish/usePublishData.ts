// One hook that gathers everything the Publish flow reads from the engine, so
// the sheet and the header controls agree on what is true.
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  PullRequestDetail,
  PullRequestRef,
  SourceControlDiscoveryResult,
  ThreadId,
  ThreadPullRequestLink,
  VcsStatusResult,
} from "@t3tools/contracts";

import { useEnvironmentQuery } from "~/state/query";

import * as DateTime from "effect/DateTime";

import type { WhatChanged } from "../../plain/changes";
import { useKeptVersions } from "../review/keptVersions";
import { rootCheckpoints } from "../review/turnReview";
import { buildTimeline } from "../versions/timeline";
import { useUndonePoints } from "../versions/undonePoints";
import {
  changesFromDiff,
  changesFromWorkingTree,
  collectCheckRuns,
  filesOutsideConversation,
  githubConnection,
  latestTurnCount,
  pickPullRequestLink,
  uploadedTurnCount,
  uploadReversesOnline,
  uploadStillCurrent,
  type CheckRun,
  type GitHubConnection,
  type RemoteKind,
} from "./model";
import { useLastUpload, type UploadRecord } from "./uploads";
import {
  canWriteSourceControlAtom,
  orchestrationEnvironment,
  pullRequestDetail,
  sourceControlEnvironment,
  vcsEnvironment,
} from "./state";

export interface PublishData {
  readonly cwd: string | null;
  readonly vcs: VcsStatusResult | null;
  readonly vcsPending: boolean;
  readonly discovery: SourceControlDiscoveryResult | null;
  readonly connection: GitHubConnection;
  readonly link: ThreadPullRequestLink | null;
  readonly linkRef: PullRequestRef | null;
  readonly detail: PullRequestDetail | null;
  readonly changes: WhatChanged | null;
  /**
   * What the next upload carries relative to the online copy, when this
   * conversation was uploaded before and has moved on since. Null otherwise.
   */
  readonly sinceUpload: WhatChanged | null;
  /** The next upload puts something back to how it was before the conversation. */
  readonly reversesOnline: boolean;
  /** False when `changes` came from the working tree, which cannot tell added from deleted. */
  readonly operationsKnown: boolean;
  readonly changesPending: boolean;
  readonly outsideConversation: ReadonlyArray<string>;
  readonly checkRuns: ReadonlyArray<CheckRun>;
  readonly canWrite: boolean;
  /** GitHub, some other online copy, or none: who to name when a push fails. */
  readonly remoteKind: RemoteKind;
  /** Kept versions this publish would reverse: kept, then undone in-app. */
  readonly reversedKept: ReadonlyArray<{
    readonly subject: string;
    readonly number: number | null;
  }>;
  /** Turns that changed files and still stand; more than one means the sheet counts the lot. */
  readonly turnsWithChanges: number;
  readonly lastUpload: UploadRecord | null;
  /** True while the last upload still covers everything. */
  readonly uploadCurrent: boolean;
}

export function pullRequestRefFor(
  shell: EnvironmentThreadShell | null,
  link: ThreadPullRequestLink | null,
): PullRequestRef | null {
  if (!shell || !link) return null;
  return {
    projectId: shell.projectId,
    host: link.host,
    repository: link.repository,
    number: link.number,
  };
}

/**
 * `wantDetail` keeps the GitHub detail fetch to the moments that need it (an
 * open review in the strip, the sheet being open) instead of every render of
 * every conversation.
 */
export function usePublishData(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly wantDetail: boolean;
  readonly wantChanges: boolean;
}): PublishData {
  const { environmentId, threadId, shell, project, projection } = input;
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;

  const vcsQuery = useEnvironmentQuery(
    cwd === null
      ? null
      : vcsEnvironment.status({ environmentId, input: { cwd, includeRemote: true } }),
  );
  const vcs = vcsQuery.data ?? null;

  const discoveryQuery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const discovery = discoveryQuery.data ?? null;

  const link = pickPullRequestLink(shell?.pullRequests);
  const linkRef = pullRequestRefFor(shell, link);
  const detailQuery = useEnvironmentQuery(
    input.wantDetail && linkRef !== null
      ? pullRequestDetail({ environmentId, input: linkRef })
      : null,
  );

  const turnCount = projection ? latestTurnCount(projection.checkpoints, projection.runs) : null;
  const diffQuery = useEnvironmentQuery(
    input.wantChanges && turnCount !== null && turnCount > 0
      ? orchestrationEnvironment.fullThreadDiff({
          environmentId,
          input: { threadId, toTurnCount: turnCount },
        })
      : null,
  );
  const fromDiff = changesFromDiff(diffQuery.data?.diff ?? null);
  const changes = fromDiff ?? (diffQuery.isPending ? null : changesFromWorkingTree(vcs));

  const canWrite = useAtomValue(canWriteSourceControlAtom(environmentId));

  const kept = useKeptVersions(threadId);
  const lastUpload = useLastUpload(threadId);
  // After an upload, the online copy is the baseline: the conversation's net
  // diff can be empty while the upload reverses what is online (QA-P2-3-05).
  const uploadedTurn = projection
    ? uploadedTurnCount(projection.checkpoints, projection.runs, lastUpload?.at ?? null)
    : null;
  const sinceUploadQuery = useEnvironmentQuery(
    input.wantChanges && uploadedTurn !== null && turnCount !== null && uploadedTurn < turnCount
      ? orchestrationEnvironment.turnDiff({
          environmentId,
          input: { threadId, fromTurnCount: uploadedTurn, toTurnCount: turnCount },
        })
      : null,
  );
  const sinceUpload = changesFromDiff(sinceUploadQuery.data?.diff ?? null);
  const rolledBackRuns = new Set(
    (projection?.runs ?? []).filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const undonePoints = useUndonePoints(threadId);
  const numbers = projection
    ? buildTimeline(projection, shell, kept, undonePoints).numbers
    : new Map();
  const reversedKept = kept.flatMap((record) => {
    if (!record.checkpointId || !projection) return [];
    const checkpoint = projection.checkpoints.find((c) => c.id === record.checkpointId);
    if (!checkpoint) return [];
    const undone =
      checkpoint.status === "stale" ||
      (checkpoint.runId !== null && rolledBackRuns.has(checkpoint.runId));
    return undone
      ? [{ subject: record.subject, number: numbers.get(record.checkpointId) ?? null }]
      : [];
  });
  const standing = projection
    ? rootCheckpoints(projection).filter(
        (c) => c.files.length > 0 && (c.runId === null || !rolledBackRuns.has(c.runId)),
      )
    : [];
  const latestChangeAt =
    standing.length > 0 ? DateTime.formatIso(standing.at(-1)!.capturedAt) : null;
  const remoteKind: RemoteKind = !vcs?.hasPrimaryRemote
    ? "none"
    : vcs.sourceControlProvider?.kind === "github"
      ? "github"
      : "other";

  return {
    cwd,
    vcs,
    vcsPending: vcsQuery.isPending && vcs === null,
    discovery,
    connection: githubConnection(vcs, discovery),
    link,
    linkRef,
    detail: detailQuery.data ?? null,
    changes,
    sinceUpload,
    reversesOnline: uploadReversesOnline(sinceUpload, fromDiff),
    operationsKnown: fromDiff !== null,
    changesPending: diffQuery.isPending && changes === null,
    outsideConversation: fromDiff === null ? [] : filesOutsideConversation(vcs, fromDiff),
    checkRuns: projection ? collectCheckRuns(projection.turnItems) : [],
    canWrite,
    remoteKind,
    reversedKept,
    turnsWithChanges: standing.length,
    lastUpload,
    uploadCurrent: uploadStillCurrent(vcs, lastUpload, latestChangeAt),
  };
}
