import type {
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStackedAction,
  PullRequestMergeMethod,
  ThreadPullRequestSnapshot,
} from "@t3tools/contracts";

import { git as copy } from "./copy";

export type PlainGitIntent = "keepThisVersion" | "sendForReview" | "putItLive";

export interface GitContext {
  readonly cwd: string;
  readonly currentBranch: string | null;
  readonly defaultBranch: string | null;
  readonly hasRemote: boolean;
  readonly hasUncommittedChanges: boolean;
  /** The review already linked to this conversation, if any. */
  readonly pullRequest?: ThreadPullRequestSnapshot | null;
  readonly pullRequestNumber?: number | null;
  readonly commitMessage?: string;
  readonly filePaths?: ReadonlyArray<string>;
}

export type GitPlan =
  | {
      readonly intent: PlainGitIntent;
      readonly kind: "stacked";
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      /** Minus `actionId`, which the caller mints. */
      readonly input: Omit<GitRunStackedActionInput, "actionId">;
      readonly guard?: string;
      readonly ready: true;
    }
  | {
      readonly intent: "putItLive";
      readonly kind: "merge";
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      readonly pullRequestNumber: number;
      readonly method: PullRequestMergeMethod;
      readonly ready: boolean;
      readonly blockers: ReadonlyArray<string>;
    }
  | {
      readonly intent: PlainGitIntent;
      readonly kind: "blocked";
      readonly label: string;
      readonly reason: string;
      readonly advanced: string;
      readonly ready: false;
    };

const DEFAULT_BRANCH_NAMES = new Set([
  "main",
  "master",
  "trunk",
  "production",
  "prod",
  "release",
  "develop",
]);

export function isDefaultBranch(
  branch: string | null | undefined,
  defaultBranch: string | null | undefined,
): boolean {
  if (!branch) return false;
  if (defaultBranch) return branch === defaultBranch;
  return DEFAULT_BRANCH_NAMES.has(branch);
}

/**
 * Maps the three plain buttons onto real git actions. Invariant: nothing produced here ever
 * pushes to the default branch. "Send for review" from the default branch forces a feature
 * branch (`featureBranch: true`) and says so.
 */
export function planGitIntent(intent: PlainGitIntent, ctx: GitContext): GitPlan {
  const onLive = isDefaultBranch(ctx.currentBranch, ctx.defaultBranch);
  const common = {
    cwd: ctx.cwd,
    ...(ctx.commitMessage ? { commitMessage: ctx.commitMessage } : {}),
    ...(ctx.filePaths && ctx.filePaths.length > 0 ? { filePaths: ctx.filePaths } : {}),
  };

  switch (intent) {
    case "keepThisVersion": {
      if (!ctx.hasUncommittedChanges) {
        return {
          intent,
          kind: "blocked",
          label: copy.keepThisVersion.label,
          reason: copy.nothingToKeep,
          advanced: copy.keepThisVersion.advanced,
          ready: false,
        };
      }
      // Committing on the live branch is local and harmless; moving to a draft line happens at
      // "Send for review" time so the user's mental model stays "keep = save on this computer".
      return {
        intent,
        kind: "stacked",
        label: copy.keepThisVersion.label,
        explainer: copy.keepThisVersion.explainer,
        advanced: copy.keepThisVersion.advanced,
        input: { ...common, action: "commit" satisfies GitStackedAction },
        ready: true,
      };
    }
    case "sendForReview": {
      if (!ctx.hasRemote) {
        return {
          intent,
          kind: "blocked",
          label: copy.sendForReview.label,
          reason: copy.noRemote,
          advanced: copy.sendForReview.advanced,
          ready: false,
        };
      }
      const existing = ctx.pullRequest;
      if (existing && existing.state === "open" && !onLive) {
        return {
          intent,
          kind: "stacked",
          label: copy.updateReview.label,
          explainer: copy.updateReview.explainer,
          advanced: copy.updateReview.advanced,
          input: {
            ...common,
            action: (ctx.hasUncommittedChanges ? "commit_push" : "push") satisfies GitStackedAction,
          },
          ready: true,
        };
      }
      return {
        intent,
        kind: "stacked",
        label: copy.sendForReview.label,
        explainer: copy.sendForReview.explainer,
        advanced: copy.sendForReview.advanced,
        input: {
          ...common,
          action: "commit_push_pr" satisfies GitStackedAction,
          ...(onLive ? { featureBranch: true } : {}),
        },
        ...(onLive
          ? {
              guard: `${copy.onLiveVersionGuard(ctx.currentBranch ?? "main")} ${copy.neverPushLive}`,
            }
          : {}),
        ready: true,
      };
    }
    case "putItLive": {
      const pr = ctx.pullRequest;
      const number = ctx.pullRequestNumber ?? null;
      if (!pr || number === null) {
        return {
          intent,
          kind: "blocked",
          label: copy.putItLive.label,
          reason: copy.blockers.noReview,
          advanced: copy.putItLive.advanced,
          ready: false,
        };
      }
      const blockers = mergeBlockers(pr);
      return {
        intent,
        kind: "merge",
        label: copy.putItLive.label,
        explainer: copy.putItLive.explainer,
        advanced: copy.putItLive.advanced,
        pullRequestNumber: number,
        method: "squash",
        ready: blockers.length === 0,
        blockers,
      };
    }
  }
}

export function mergeBlockers(pr: ThreadPullRequestSnapshot): Array<string> {
  const blockers: Array<string> = [];
  if (pr.state === "merged") return [copy.blockers.alreadyLive];
  if (pr.state === "closed") return [copy.blockers.closed];
  if (pr.reviewDecision !== "approved") blockers.push(copy.blockers.notApproved);
  if (pr.checksState === "failing") blockers.push(copy.blockers.checksFailing);
  if (pr.checksState === "pending") blockers.push(copy.blockers.checksPending);
  if (pr.mergeability === "conflicting") blockers.push(copy.blockers.conflicting);
  return blockers;
}

export interface PullRequestStatus {
  readonly label: string;
  readonly tone: "neutral" | "good" | "attention" | "bad" | "live";
  readonly advanced: string;
}

export function describePullRequestState(pr: ThreadPullRequestSnapshot): PullRequestStatus {
  const advanced = `Advanced: pull request ${pr.headBranch} → ${pr.baseBranch}, ${pr.isDraft ? "draft, " : ""}${pr.state}${pr.reviewDecision ? `, review ${pr.reviewDecision}` : ""}${pr.checksState ? `, checks ${pr.checksState}` : ""}`;
  if (pr.state === "merged") return { label: copy.prStates.merged, tone: "live", advanced };
  if (pr.state === "closed") return { label: copy.prStates.closed, tone: "neutral", advanced };
  if (pr.mergeability === "conflicting")
    return { label: copy.prStates.conflicting, tone: "bad", advanced };
  if (pr.checksState === "failing")
    return { label: copy.prStates.checksFailing, tone: "bad", advanced };
  if (pr.reviewDecision === "changes-requested")
    return { label: copy.prStates.changesRequested, tone: "attention", advanced };
  if (pr.isDraft) return { label: copy.prStates.draftOpen, tone: "neutral", advanced };
  if (pr.reviewDecision === "approved")
    return { label: copy.prStates.approved, tone: "good", advanced };
  if (pr.checksState === "pending")
    return { label: copy.prStates.checksRunning, tone: "neutral", advanced };
  return { label: copy.prStates.waitingForReview, tone: "neutral", advanced };
}

/** One plain sentence for the toast after a stacked action ran. */
export function describeStackedResult(result: GitRunStackedActionResult): string {
  const parts: Array<string> = [];
  if (result.branch.status === "created")
    parts.push(`started a draft line${result.branch.name ? ` (${result.branch.name})` : ""}`);
  if (result.commit.status === "created") parts.push("kept this version");
  else if (result.commit.status === "skipped_no_changes") parts.push("nothing new to keep");
  if (result.push.status === "pushed") parts.push("uploaded it to the online copy");
  else if (result.push.status === "skipped_up_to_date")
    parts.push("the online copy was already up to date");
  if (result.pr.status === "created")
    parts.push(`opened a review${result.pr.number ? ` (#${result.pr.number})` : ""}`);
  else if (result.pr.status === "opened_existing")
    parts.push(`updated the open review${result.pr.number ? ` (#${result.pr.number})` : ""}`);
  if (parts.length === 0) return "Nothing to do.";
  const sentence =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
}

export const ADVANCED_TERMS: Readonly<Record<PlainGitIntent, string>> = {
  keepThisVersion: copy.keepThisVersion.advanced,
  sendForReview: copy.sendForReview.advanced,
  putItLive: copy.putItLive.advanced,
};
