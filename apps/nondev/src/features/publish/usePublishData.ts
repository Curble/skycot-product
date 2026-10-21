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

import type { WhatChanged } from "../../plain/changes";
import {
  changesFromDiff,
  changesFromWorkingTree,
  collectCheckRuns,
  filesOutsideConversation,
  githubConnection,
  latestTurnCount,
  pickPullRequestLink,
  type CheckRun,
  type GitHubConnection,
} from "./model";
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
  /** False when `changes` came from the working tree, which cannot tell added from deleted. */
  readonly operationsKnown: boolean;
  readonly changesPending: boolean;
  readonly outsideConversation: ReadonlyArray<string>;
  readonly checkRuns: ReadonlyArray<CheckRun>;
  readonly canWrite: boolean;
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

  const turnCount = projection ? latestTurnCount(projection.checkpoints) : null;
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
    operationsKnown: fromDiff !== null,
    changesPending: diffQuery.isPending && changes === null,
    outsideConversation: fromDiff === null ? [] : filesOutsideConversation(vcs, fromDiff),
    checkRuns: projection ? collectCheckRuns(projection.turnItems) : [],
    canWrite,
  };
}
