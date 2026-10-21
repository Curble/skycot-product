// Engine access for the Publish flow. Mirrors apps/web's state/vcs.ts,
// state/source-control.ts and state/orchestration.ts, but the pull-request
// pieces are built directly from the RPC factories: this client's runtime has
// no PullRequestDiffLoader layer, which `createPullRequestEnvironmentAtoms`
// requires for diff loading we never do here.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import {
  AuthSourceControlWriteScope,
  type EnvironmentId,
  sessionGrantsScope,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentSession } from "../../state/session";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);

export const pullRequestDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "nondev-publish:pull-request-detail",
  tag: WS_METHODS.pullRequestsDetail,
  staleTimeMs: 60_000,
});

export const pullRequestReviewerCandidates = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "nondev-publish:pull-request-reviewer-candidates",
    tag: WS_METHODS.pullRequestsReviewerCandidates,
    staleTimeMs: 60_000,
  },
);

// Both are in CLIENT_GUARDED_RPC_SCOPES, so each carries a `permissionAtom`.
export const runPullRequestAction = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "nondev-publish:pull-request-run-action",
  tag: WS_METHODS.pullRequestsRunAction,
});

export const requestPullRequestReviewers = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "nondev-publish:pull-request-request-reviewers",
  tag: WS_METHODS.pullRequestsRequestReviewers,
});

// `git.runStackedAction` is guarded by the source-control write scope; the
// stock UI gates its buttons on the same session grant (useEnvironmentScope).
export const canWriteSourceControlAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const result = get(environmentSession.sessionStateAtom(environmentId));
    const session = Option.getOrNull(AsyncResult.value(result));
    return (
      result._tag !== "Failure" &&
      session !== null &&
      sessionGrantsScope(session, AuthSourceControlWriteScope)
    );
  }).pipe(Atom.withLabel(`nondev-can-write-source-control:${environmentId}`)),
);
