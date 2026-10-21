// Pure decisions for the Publish flow: what the header pill says, whether the
// button is live, what the safety check can honestly claim, and which real
// action each plain choice maps to. No React, no atoms; tested in model.test.ts.
import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  ProjectScript,
  PullRequestDetail,
  SourceControlDiscoveryResult,
  ThreadPullRequestLink,
  VcsStatusResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  describeChanges,
  describeTurnDiff,
  type ChangeArea,
  type FileChange,
  type WhatChanged,
} from "../../plain/changes";
import { copy, type GitPlan, describePullRequestState, planGitIntent } from "../../plain";
import { classifyCommand } from "../../plain/narration";
import { CREW_NAME } from "../../brand";
import type { PillTone } from "../../ui/Pill";

export const SETTINGS_HREF = "#/settings";

export const HONESTY_NOTE = "This check catches common problems. It isn't a guarantee.";

/** The review this conversation is about: an open one first, else the newest. */
export function pickPullRequestLink(
  links: ReadonlyArray<ThreadPullRequestLink> | undefined,
): ThreadPullRequestLink | null {
  const visible = (links ?? []).filter((link) => link.source !== "stack-dismissed");
  if (visible.length === 0) return null;
  const byNewest = [...visible].sort((a, b) => Date.parse(b.linkedAt) - Date.parse(a.linkedAt));
  return byNewest.find((link) => link.snapshot?.state === "open") ?? byNewest[0]!;
}

export function reviewerDisplayName(
  actor: { readonly login: string; readonly name: string | null } | null | undefined,
): string | null {
  if (!actor) return null;
  const name = actor.name?.trim();
  return name && name.length > 0 ? name : actor.login;
}

export interface PublishStatus {
  readonly label: string;
  readonly tone: PillTone;
  /** Developer wording for "Show details" / tooltips. */
  readonly advanced: string;
}

const PR_TONE: Record<ReturnType<typeof describePullRequestState>["tone"], PillTone> = {
  neutral: "neutral",
  good: "ok",
  attention: "waiting",
  bad: "danger",
  live: "ok",
};

/**
 * The strip pill. Null when there is nothing to say (no review, nothing to
 * publish) so the strip stays quiet on a fresh conversation.
 */
export function describePublishStatus(input: {
  readonly link: ThreadPullRequestLink | null;
  readonly reviewers?: ReadonlyArray<{ readonly login: string; readonly name: string | null }>;
  readonly hasSomethingToPublish: boolean;
  /** ISO time of the last upload from this app, when nothing new has happened since. */
  readonly uploadedAt?: string | null;
  readonly formatTime?: (iso: string) => string;
}): PublishStatus | null {
  const snapshot = input.link?.snapshot ?? null;
  if (snapshot) {
    const state = describePullRequestState(snapshot);
    if (snapshot.state === "merged") {
      const when = snapshot.mergedAt ?? snapshot.updatedAt ?? null;
      return {
        label: when ? `Live · ${(input.formatTime ?? defaultFormatTime)(when)}` : "Live",
        tone: "ok",
        advanced: state.advanced,
      };
    }
    if (snapshot.state === "open" && snapshot.reviewDecision === "approved") {
      return { label: "Approved · ready to go live", tone: "ok", advanced: state.advanced };
    }
    if (
      snapshot.state === "open" &&
      state.tone === "neutral" &&
      !snapshot.isDraft &&
      snapshot.checksState !== "pending"
    ) {
      const names = (input.reviewers ?? []).map(reviewerDisplayName).filter(isString);
      return {
        label: names.length > 0 ? `Waiting for ${joinList(names)}` : "Waiting for a reviewer",
        tone: "neutral",
        advanced: state.advanced,
      };
    }
    return { label: state.label, tone: PR_TONE[state.tone], advanced: state.advanced };
  }
  if (input.uploadedAt) {
    return {
      label: `Uploaded · ${(input.formatTime ?? defaultFormatTime)(input.uploadedAt)}`,
      tone: "neutral",
      advanced: "Advanced: the draft branch is on the remote; no pull request is linked yet.",
    };
  }
  if (input.hasSomethingToPublish) {
    return {
      label: "Not live yet",
      tone: "neutral",
      advanced: "Advanced: no pull request is linked yet.",
    };
  }
  return null;
}

/** True when the last upload still covers everything: nothing new since, locally or in commits. */
export function uploadStillCurrent(
  vcs: VcsStatusResult | null,
  upload: { readonly at: string } | null,
  latestChangeAt: string | null,
): boolean {
  if (!vcs || upload === null) return false;
  if (vcs.hasWorkingTreeChanges || vcs.aheadCount > 0) return false;
  if (latestChangeAt !== null && Date.parse(latestChangeAt) > Date.parse(upload.at)) return false;
  return true;
}

function defaultFormatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export interface PublishReadiness {
  readonly enabled: boolean;
  /** Tooltip when disabled. */
  readonly reason: string;
}

export function hasSomethingToPublish(
  vcs: VcsStatusResult | null,
  link: ThreadPullRequestLink | null,
): boolean {
  if (link?.snapshot?.state === "open") return true;
  if (!vcs || !vcs.isRepo) return false;
  return (
    vcs.hasWorkingTreeChanges ||
    vcs.aheadCount > 0 ||
    (!vcs.isDefaultRef && (vcs.aheadOfDefaultCount ?? 0) > 0 && vcs.pr?.state !== "merged")
  );
}

export function publishReadiness(input: {
  readonly vcs: VcsStatusResult | null;
  readonly link: ThreadPullRequestLink | null;
  readonly active: boolean;
  readonly canOperate: boolean;
}): PublishReadiness {
  if (!input.canOperate) {
    return { enabled: false, reason: "This connection can look but not publish." };
  }
  if (input.active) {
    return { enabled: false, reason: "Wait until the work finishes, then publish." };
  }
  if (input.vcs === null) {
    return { enabled: false, reason: "Checking what has changed…" };
  }
  if (!input.vcs.isRepo) {
    return {
      enabled: false,
      reason: "This folder doesn't keep versions yet, so there's nothing to publish from.",
    };
  }
  if (!hasSomethingToPublish(input.vcs, input.link)) {
    return { enabled: false, reason: "Nothing to publish yet — ask for a change first." };
  }
  return { enabled: true, reason: "" };
}

export type SafetyState = "ok" | "warn" | "fail" | "unknown";

export interface SafetyLine {
  readonly state: SafetyState;
  readonly text: string;
  readonly detail?: string;
}

export interface CheckRun {
  readonly command: string;
  /** What the command was, in plain words ("ran the project's checks"). */
  readonly what: string;
  readonly outcome: "passed" | "failed" | "running" | "unknown";
}

/** Commands this conversation ran that count as checks: tests, lint, build, typecheck. */
export function collectCheckRuns(items: ReadonlyArray<OrchestrationV2TurnItem>): Array<CheckRun> {
  const runs: Array<CheckRun> = [];
  for (const item of items) {
    if (item.type !== "command_execution") continue;
    const classification = classifyCommand(item.input);
    if (classification.kind !== "test") continue;
    const outcome: CheckRun["outcome"] =
      item.status === "running" || item.status === "pending" || item.status === "waiting"
        ? "running"
        : item.status === "failed" || item.outputIndicatesFailure === true
          ? "failed"
          : item.exitCode === undefined
            ? item.status === "completed"
              ? "passed"
              : "unknown"
            : item.exitCode === 0
              ? "passed"
              : "failed";
    runs.push({ command: item.input, what: classification.past, outcome });
  }
  return runs;
}

export interface ChangeSource {
  /** What this conversation changed, from the engine's diff of its checkpoints. */
  readonly conversation: WhatChanged | null;
  /** Files changed on disk right now that the conversation's diff does not mention. */
  readonly outsideConversation: ReadonlyArray<string>;
  /** True while the diff is still loading. */
  readonly pending: boolean;
}

/**
 * The newest turn whose changes still stand. An undone turn's checkpoint keeps
 * its ordinal, but the engine has rolled the thread back past it, so asking for
 * that range fails and its changes are not what would be published.
 */
export function latestTurnCount(
  checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>,
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">> = [],
): number | null {
  const rolledBack = new Set(
    runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  let max: number | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.appRunOrdinal === null) continue;
    if (checkpoint.runId !== null && rolledBack.has(checkpoint.runId)) continue;
    if (max === null || checkpoint.appRunOrdinal > max) max = checkpoint.appRunOrdinal;
  }
  return max;
}

/**
 * The turn the last upload carried: the newest standing checkpoint captured
 * before it. Null without an upload, or when the upload predates every turn.
 */
export function uploadedTurnCount(
  checkpoints: ReadonlyArray<OrchestrationV2Checkpoint>,
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>,
  uploadAt: string | null,
): number | null {
  if (uploadAt === null) return null;
  const at = Date.parse(uploadAt);
  if (Number.isNaN(at)) return null;
  const rolledBack = new Set(
    runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  let max: number | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.appRunOrdinal === null) continue;
    if (checkpoint.runId !== null && rolledBack.has(checkpoint.runId)) continue;
    if (DateTime.toEpochMillis(checkpoint.capturedAt) > at) continue;
    if (max === null || checkpoint.appRunOrdinal > max) max = checkpoint.appRunOrdinal;
  }
  return max;
}

/**
 * True when the upload puts a file back to how it was before the conversation:
 * the online copy has the change, the conversation as a whole no longer does.
 */
export function uploadReversesOnline(
  sinceUpload: WhatChanged | null,
  conversation: WhatChanged | null,
): boolean {
  if (sinceUpload === null || conversation === null) return false;
  const stillChanged = new Set(
    conversation.groups.flatMap((group) => group.files.map((file) => file.path)),
  );
  return sinceUpload.groups.some((group) =>
    group.files.some((file) => !stillChanged.has(file.path)),
  );
}

export function changesFromDiff(diff: string | null): WhatChanged | null {
  if (diff === null) return null;
  return describeTurnDiff(diff);
}

/** Fallback when there is no diff yet: the working tree only knows paths and line counts. */
export function changesFromWorkingTree(vcs: VcsStatusResult | null): WhatChanged | null {
  if (!vcs || vcs.workingTree.files.length === 0) return null;
  const files: Array<FileChange> = vcs.workingTree.files.map((file) => ({
    path: file.path,
    operation: "edited",
    additions: file.insertions,
    deletions: file.deletions,
  }));
  return describeChanges(files);
}

export function filesOutsideConversation(
  vcs: VcsStatusResult | null,
  conversation: WhatChanged | null,
): Array<string> {
  if (!vcs || conversation === null) return [];
  const known = new Set(conversation.groups.flatMap((group) => group.files.map((f) => f.path)));
  return vcs.workingTree.files.map((file) => file.path).filter((path) => !known.has(path));
}

function pluralFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** "1 settings file", "2 pages": the same nouns the What-changed card uses. */
export function areaFileNoun(area: ChangeArea, count: number): string {
  switch (area) {
    case "pages":
      return count === 1 ? "page" : "pages";
    case "styles":
      return count === 1 ? "style file" : "style files";
    case "content":
      return count === 1 ? "content file" : "content files";
    case "settings":
      return count === 1 ? "settings file" : "settings files";
    case "behind the scenes":
      return count === 1 ? "file behind the scenes" : "files behind the scenes";
  }
}

/**
 * Every line is backed by something the engine told us. Anything we could not
 * see is "Not checked", never a green tick.
 */
export function buildSafetyCheck(input: {
  readonly changes: ChangeSource;
  readonly checkRuns: ReadonlyArray<CheckRun>;
  readonly operationsKnown: boolean;
  /** Kept versions this publish would reverse (undone in-app after being kept). */
  readonly reversedKept?: ReadonlyArray<{
    readonly subject: string;
    readonly number: number | null;
  }>;
}): { readonly lines: ReadonlyArray<SafetyLine>; readonly summary: string } {
  const lines: Array<SafetyLine> = [];
  const changes = input.changes.conversation;

  if (input.changes.pending && changes === null) {
    lines.push({ state: "unknown", text: "Still working out which files changed…" });
  } else if (changes === null) {
    lines.push({ state: "unknown", text: "Not checked — couldn't read what changed." });
  } else {
    const groups = changes.groups.map(
      (g) => `${g.files.length} ${areaFileNoun(g.area, g.files.length)}`,
    );
    lines.push({
      state: "ok",
      text: `${pluralFiles(changes.counts.files)} changed${groups.length > 0 ? `: ${joinList(groups)}` : ""}.`,
      detail: changes.groups
        .flatMap((group) => group.files.map((file) => `${file.line} — ${file.path}`))
        .join("\n"),
    });

    if (input.operationsKnown) {
      lines.push(
        changes.flags.filesDeleted.length === 0
          ? { state: "ok", text: "Nothing was deleted." }
          : {
              state: "warn",
              text: `${pluralFiles(changes.flags.filesDeleted.length)} ${changes.flags.filesDeleted.length === 1 ? "was" : "were"} deleted — worth a second look.`,
              detail: changes.flags.filesDeleted.join("\n"),
            },
      );
    } else {
      lines.push({
        state: "unknown",
        text: "Not checked — can't tell yet whether anything was deleted.",
      });
    }

    const secrets = changes.flags.configOrSecretsTouched.filter(
      (path) => !changes.flags.dependenciesChanged.includes(path),
    );
    lines.push(
      secrets.length === 0
        ? { state: "ok", text: "No settings or secret files were touched." }
        : {
            state: "warn",
            text: copy.changes.flags.configOrSecretsTouched,
            detail: secrets.join("\n"),
          },
    );
    if (changes.flags.dependenciesChanged.length > 0) {
      lines.push({
        state: "warn",
        text: copy.changes.flags.dependenciesChanged,
        detail: changes.flags.dependenciesChanged.join("\n"),
      });
    }
  }

  if (input.changes.outsideConversation.length > 0) {
    lines.push({
      state: "warn",
      text: `${pluralFiles(input.changes.outsideConversation.length)} changed outside this conversation will go along too.`,
      detail: input.changes.outsideConversation.join("\n"),
    });
  }

  const reversed = input.reversedKept ?? [];
  if (reversed.length > 0) {
    lines.push({
      state: "warn",
      text: `This undoes ${reversed.length === 1 ? "a version that was already kept" : `${reversed.length} versions that were already kept`} — the upload carries the reversal.`,
      detail: reversed
        .map(
          (kept) =>
            `${kept.number === null ? "Kept version" : `Version ${kept.number}`}: ${kept.subject}`,
        )
        .join("\n"),
    });
  }

  const checks = input.checkRuns;
  if (checks.length === 0) {
    lines.push({
      state: "unknown",
      text: "Not checked — no tests or build ran in this conversation.",
    });
  } else if (checks.some((run) => run.outcome === "failed")) {
    lines.push({
      state: "fail",
      text: "A check found problems.",
      detail: checks.map((run) => `${run.outcome}: ${run.command}`).join("\n"),
    });
  } else if (checks.some((run) => run.outcome === "running")) {
    lines.push({ state: "unknown", text: "Checks are still running." });
  } else if (checks.every((run) => run.outcome === "passed")) {
    lines.push({
      state: "ok",
      text: `Checks passed (${joinList(unique(checks.map((run) => run.what.toLowerCase())))}).`,
      detail: checks.map((run) => run.command).join("\n"),
    });
  } else {
    lines.push({ state: "unknown", text: "Not checked — a check ran but didn't say how it went." });
  }

  const warnings = lines.filter((line) => line.state === "warn").length;
  const fails = lines.filter((line) => line.state === "fail").length;
  const unknowns = lines.filter((line) => line.state === "unknown").length;
  const parts: Array<string> = [];
  if (fails > 0) parts.push(`${fails} ${fails === 1 ? "problem" : "problems"}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "note" : "notes"}`);
  if (unknowns > 0) parts.push(`${unknowns} not checked`);
  return {
    lines,
    summary: parts.length === 0 ? "No issues found" : parts.join(" · "),
  };
}

export type GitHubConnection = "connected" | "no-remote" | "remote-not-github" | "not-signed-in";

export function githubConnection(
  vcs: VcsStatusResult | null,
  discovery: SourceControlDiscoveryResult | null,
): GitHubConnection {
  if (!vcs || !vcs.hasPrimaryRemote) return "no-remote";
  if (vcs.sourceControlProvider?.kind !== "github") return "remote-not-github";
  const github = discovery?.sourceControlProviders.find((p) => p.kind === "github") ?? null;
  if (github === null) return "connected";
  if (github.status !== "available" || github.auth.status === "unauthenticated") {
    return "not-signed-in";
  }
  return "connected";
}

export type ReviewChoice =
  | {
      readonly kind: "review";
      /** Opens a pull request too. False when the remote is not GitHub. */
      readonly opensReview: boolean;
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      readonly guard?: string;
      readonly plan: Extract<GitPlan, { kind: "stacked" }>;
    }
  | {
      readonly kind: "keep";
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      readonly plan: Extract<GitPlan, { kind: "stacked" }>;
    }
  | {
      readonly kind: "blocked";
      readonly label: string;
      readonly reason: string;
      readonly advanced: string;
    };

export function resolveReviewChoice(input: {
  readonly vcs: VcsStatusResult | null;
  readonly cwd: string;
  readonly link: ThreadPullRequestLink | null;
  readonly connection: GitHubConnection;
}): ReviewChoice {
  const vcs = input.vcs;
  const label = copy.git.sendForReview.label;
  const advanced = copy.git.sendForReview.advanced;
  if (!vcs || !vcs.isRepo) {
    return {
      kind: "blocked",
      label,
      reason: "This folder doesn't keep versions yet.",
      advanced,
    };
  }
  const defaultBranch = vcs.branchChanges?.baseRef ?? (vcs.isDefaultRef ? vcs.refName : null);
  const ctx = {
    cwd: input.cwd,
    currentBranch: vcs.refName,
    defaultBranch,
    hasRemote: vcs.hasPrimaryRemote,
    hasUncommittedChanges: vcs.hasWorkingTreeChanges,
    pullRequest: input.link?.snapshot ?? null,
    pullRequestNumber: input.link?.number ?? null,
  };

  if (input.connection === "no-remote") {
    const keep = planGitIntent("keepThisVersion", ctx);
    if (keep.kind !== "stacked") {
      return {
        kind: "blocked",
        label: copy.git.keepThisVersion.label,
        reason: keep.kind === "blocked" ? keep.reason : copy.git.nothingToKeep,
        advanced: keep.advanced,
      };
    }
    return {
      kind: "keep",
      label: "Keep this version (saved on this Mac)",
      explainer: `${copy.git.noRemote} ${copy.git.keepThisVersion.explainer}`,
      advanced: keep.advanced,
      plan: keep,
    };
  }

  const plan = planGitIntent("sendForReview", ctx);
  if (plan.kind !== "stacked") {
    return {
      kind: "blocked",
      label,
      reason: plan.kind === "blocked" ? plan.reason : plan.blockers.join(" "),
      advanced,
    };
  }
  // The server names the draft line from the uncommitted changes, so a clean
  // tree on the live line has nothing to move. Never push the live line instead.
  if (plan.input.featureBranch === true && !vcs.hasWorkingTreeChanges) {
    return {
      kind: "blocked",
      label,
      reason: `These changes are already saved on the live line (${vcs.refName ?? "main"}) and there's nothing new to move onto a draft line. ${copy.git.neverPushLive}`,
      advanced,
    };
  }
  if (input.connection === "connected") {
    return {
      kind: "review",
      opensReview: plan.input.action === "commit_push_pr",
      label: plan.label,
      explainer: plan.explainer,
      advanced: `${plan.advanced}${plan.input.featureBranch ? " (new branch)" : vcs.refName ? ` on branch ${vcs.refName}` : ""}`,
      ...(plan.guard ? { guard: plan.guard } : {}),
      plan,
    };
  }
  // A remote exists but GitHub isn't connected: upload the draft line, say
  // plainly that no review can be opened, and never fall through to `gh`.
  const withoutPr = {
    ...plan,
    label: "Upload a draft line",
    input: {
      ...plan.input,
      action: (plan.input.action === "commit_push_pr"
        ? "commit_push"
        : plan.input.action) satisfies typeof plan.input.action,
    },
  };
  return {
    kind: "review",
    opensReview: false,
    label: withoutPr.label,
    explainer:
      input.connection === "remote-not-github"
        ? "Uploads your saved versions to a separate draft line on the online copy. GitHub isn't connected, so no review request can be opened yet."
        : "Uploads your saved versions to a separate draft line. You're not signed in to GitHub, so no review request can be opened yet.",
    advanced: `Advanced: git push to a feature branch${vcs.refName && !withoutPr.input.featureBranch ? ` (${vcs.refName})` : ""}; no pull request`,
    ...(plan.guard ? { guard: plan.guard } : {}),
    plan: withoutPr,
  };
}

export type LiveChoice =
  | {
      readonly kind: "merge";
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      readonly plan: Extract<GitPlan, { kind: "merge" }>;
      readonly link: ThreadPullRequestLink;
      /** True only when the host offers a real reversal of this merge. */
      readonly canTakeBack: boolean;
    }
  | {
      readonly kind: "script";
      readonly label: string;
      readonly explainer: string;
      readonly advanced: string;
      readonly script: ProjectScript;
    }
  | {
      readonly kind: "blocked";
      readonly label: string;
      readonly reason: string;
      readonly advanced: string;
    };

export function findDeployScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  return (
    scripts.find((script) => /\b(deploy|publish|release|ship|go-?live)\b/i.test(script.name)) ??
    scripts.find((script) => /\b(deploy|publish|release|ship)\b/i.test(script.id)) ??
    null
  );
}

export function resolveLiveChoice(input: {
  readonly link: ThreadPullRequestLink | null;
  readonly detail: PullRequestDetail | null;
  readonly connection: GitHubConnection;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly canWrite: boolean;
}): LiveChoice {
  const label = copy.git.putItLive.label;
  const advanced = copy.git.putItLive.advanced;
  const snapshot = input.link?.snapshot ?? null;
  if (input.link && snapshot && snapshot.state !== "closed" && snapshot.state !== "merged") {
    const plan = planGitIntent("putItLive", {
      cwd: "",
      currentBranch: snapshot.headBranch,
      defaultBranch: snapshot.baseBranch,
      hasRemote: true,
      hasUncommittedChanges: false,
      pullRequest: snapshot,
      pullRequestNumber: input.link.number,
    });
    if (plan.kind === "merge") {
      const blockers = [...plan.blockers];
      if (input.connection !== "connected") blockers.unshift("GitHub isn't connected on this Mac.");
      if (!input.canWrite) blockers.unshift("This connection can look but not publish.");
      if (input.detail && !input.detail.viewerPermissions.actions.includes("merge")) {
        blockers.push("Your GitHub account isn't allowed to combine reviews in this project.");
      }
      if (blockers.length > 0) {
        return { kind: "blocked", label, reason: blockers.join(" "), advanced };
      }
      return {
        kind: "merge",
        label,
        explainer: `${plan.explainer} Combines review #${input.link.number} into ${snapshot.baseBranch}.`,
        advanced: `${advanced} (#${input.link.number}, squash)`,
        plan,
        link: input.link,
        canTakeBack: input.detail?.capabilities.actions.includes("revert") === true,
      };
    }
    if (plan.kind === "blocked") return { kind: "blocked", label, reason: plan.reason, advanced };
  }
  const script = findDeployScript(input.scripts);
  if (script) {
    return {
      kind: "script",
      label,
      explainer: `Asks ${CREW_NAME} to run your project's “${script.name}” script in this conversation. You'll see every step here, and your usual approval setting applies before anything leaves your Mac.`,
      advanced: `Advanced: runs \`${script.command}\` via the assistant`,
      script,
    };
  }
  const reason =
    snapshot?.state === "merged"
      ? copy.git.blockers.alreadyLive
      : snapshot?.state === "closed"
        ? copy.git.blockers.closed
        : `${copy.git.blockers.noReview} This project also has no publish script, so there's no other way live from here.`;
  return { kind: "blocked", label, reason, advanced };
}

export function reviewerSummaryText(input: {
  readonly projectName: string | null;
  readonly changes: WhatChanged | null;
  readonly url: string | null;
}): string {
  const lines: Array<string> = [];
  lines.push(
    input.projectName
      ? `Changes to ${input.projectName}, ready for review.`
      : "Changes ready for review.",
  );
  if (input.changes) {
    lines.push(input.changes.summary);
    for (const group of input.changes.groups) {
      lines.push(`${group.label}:`);
      for (const file of group.files) lines.push(`  • ${file.line}`);
    }
    for (const warning of input.changes.warnings) lines.push(`Note: ${warning}`);
  }
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}

export function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function unique(values: ReadonlyArray<string>): Array<string> {
  return [...new Set(values)];
}

function isString(value: string | null): value is string {
  return value !== null;
}

export type RemoteKind = "github" | "other" | "none";

/**
 * One plain sentence for a failure, naming whoever did not respond: GitHub
 * when the remote is GitHub, otherwise "the online copy" (a folder, a
 * self-hosted server). The raw developer text stays behind "Show details".
 */
export function describeFailure(
  error: unknown,
  context: { readonly remote?: RemoteKind } = {},
): {
  readonly headline: string;
  readonly hint: string | null;
  readonly detail: string;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const permission = /scope|permission|unauthori|forbidden|not allowed/i.test(detail);
  if (permission) {
    return { headline: "This connection isn't allowed to publish.", hint: null, detail };
  }
  const unreachable =
    /remote_unreachable|could not read from remote|does not appear to be a git repository|repository .+ not found|network|ECONN|ENOTFOUND|timed? ?out|could not resolve host/i.test(
      detail,
    );
  if (/generateCommitMessage|Text generation failed/i.test(detail)) {
    return {
      headline: "Couldn't write a description for this version.",
      hint: "The assistant that names versions didn't answer. Try again in a moment; nothing was sent.",
      detail,
    };
  }
  const mentionsGitHub = /github|gh\b|pull request/i.test(detail);
  const github = context.remote === "github" || (context.remote === undefined && mentionsGitHub);
  if (unreachable || mentionsGitHub || /pushCurrentBranch|\bgit push\b/i.test(detail)) {
    return github
      ? {
          headline: copy.errors.didNotRespond("GitHub"),
          hint: "Check you're online and signed in to GitHub, then try again.",
          detail,
        }
      : {
          headline: "The online copy didn't respond.",
          hint: "Check the online copy still exists and your Mac can reach it, then try again. Nothing was lost.",
          detail,
        };
  }
  return { headline: "That didn't work.", hint: null, detail };
}
