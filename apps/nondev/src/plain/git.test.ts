import { describe, expect, it } from "vite-plus/test";

import { decodeStackedResult, pullRequest } from "./fixtures.test-helpers";
import {
  ADVANCED_TERMS,
  describePullRequestState,
  describeStackedResult,
  isDefaultBranch,
  mergeBlockers,
  planGitIntent,
  type GitContext,
} from "./git";

const base: GitContext = {
  cwd: "/Users/me/site",
  currentBranch: "t3/booking-page",
  defaultBranch: "main",
  hasRemote: true,
  hasUncommittedChanges: true,
  commitMessage: "Add a date picker to the booking page",
};

describe("planGitIntent — keep this version", () => {
  it("maps to a plain commit with the real-term small print", () => {
    const plan = planGitIntent("keepThisVersion", base);
    expect(plan).toMatchObject({
      kind: "stacked",
      label: "Keep this version",
      advanced: "Advanced: git commit",
      input: {
        cwd: "/Users/me/site",
        action: "commit",
        commitMessage: "Add a date picker to the booking page",
      },
      ready: true,
    });
    expect(plan.kind === "stacked" && "featureBranch" in plan.input).toBe(false);
    expect(ADVANCED_TERMS.keepThisVersion).toBe("Advanced: git commit");
  });

  it("is blocked when there is nothing to keep", () => {
    expect(
      planGitIntent("keepThisVersion", { ...base, hasUncommittedChanges: false }),
    ).toMatchObject({
      kind: "blocked",
      reason: "No changes to keep — everything is already saved.",
    });
  });

  it("passes through a file selection", () => {
    const plan = planGitIntent("keepThisVersion", {
      ...base,
      filePaths: ["src/pages/booking.tsx"],
    });
    expect(plan.kind === "stacked" && plan.input.filePaths).toEqual(["src/pages/booking.tsx"]);
  });
});

describe("planGitIntent — send for review", () => {
  it("commits, pushes and opens a review from a draft branch", () => {
    const plan = planGitIntent("sendForReview", base);
    expect(plan).toMatchObject({
      kind: "stacked",
      label: "Send for review",
      input: { action: "commit_push_pr" },
      ready: true,
    });
    expect(plan.kind === "stacked" && plan.guard).toBeUndefined();
    expect(plan.kind === "stacked" && plan.input.featureBranch).toBeUndefined();
  });

  it("never pushes to the live branch: forces a feature branch and explains", () => {
    for (const branch of ["main", "master"]) {
      const plan = planGitIntent("sendForReview", {
        ...base,
        currentBranch: branch,
        defaultBranch: branch,
      });
      expect(plan.kind).toBe("stacked");
      if (plan.kind !== "stacked") continue;
      expect(plan.input).toMatchObject({ action: "commit_push_pr", featureBranch: true });
      expect(plan.guard).toBe(
        `You're working on the live version (${branch}). I'll move these changes onto a separate draft line first so nothing goes live by accident. This app never uploads straight to the live version. Reviews are the only way live.`,
      );
    }
  });

  it("guesses the live branch by name when the default is unknown", () => {
    expect(isDefaultBranch("main", null)).toBe(true);
    expect(isDefaultBranch("feature/x", null)).toBe(false);
    expect(isDefaultBranch("main", "develop")).toBe(false);
    const plan = planGitIntent("sendForReview", {
      ...base,
      currentBranch: "master",
      defaultBranch: null,
    });
    expect(plan.kind === "stacked" && plan.input.featureBranch).toBe(true);
  });

  it("updates an existing open review instead of opening another", () => {
    const withPr = { ...base, pullRequest: pullRequest(), pullRequestNumber: 12 };
    expect(planGitIntent("sendForReview", withPr)).toMatchObject({
      kind: "stacked",
      label: "Update the review",
      input: { action: "commit_push" },
    });
    expect(
      planGitIntent("sendForReview", { ...withPr, hasUncommittedChanges: false }),
    ).toMatchObject({ input: { action: "push" } });
    expect(
      planGitIntent("sendForReview", { ...withPr, pullRequest: pullRequest({ state: "merged" }) }),
    ).toMatchObject({ input: { action: "commit_push_pr" } });
  });

  it("is blocked without an online copy", () => {
    expect(planGitIntent("sendForReview", { ...base, hasRemote: false })).toMatchObject({
      kind: "blocked",
      reason: expect.stringMatching(/online copy/),
    });
  });
});

describe("planGitIntent — put it live", () => {
  it("merges an approved, green, mergeable review", () => {
    const plan = planGitIntent("putItLive", {
      ...base,
      pullRequest: pullRequest({
        reviewDecision: "approved",
        checksState: "passing",
        mergeability: "mergeable",
      }),
      pullRequestNumber: 12,
    });
    expect(plan).toMatchObject({
      kind: "merge",
      pullRequestNumber: 12,
      method: "squash",
      ready: true,
      blockers: [],
      advanced: "Advanced: merge the pull request into the default branch",
    });
  });

  it("lists every blocker in plain words", () => {
    const plan = planGitIntent("putItLive", {
      ...base,
      pullRequest: pullRequest({
        reviewDecision: "review-required",
        checksState: "failing",
        mergeability: "conflicting",
      }),
      pullRequestNumber: 12,
    });
    expect(plan).toMatchObject({ kind: "merge", ready: false });
    expect(plan.kind === "merge" && plan.blockers).toEqual([
      "A reviewer hasn't approved it yet.",
      "The automatic checks found problems.",
      "It clashes with newer changes and needs untangling first.",
    ]);
    expect(
      mergeBlockers(pullRequest({ reviewDecision: "approved", checksState: "pending" })),
    ).toEqual(["The automatic checks haven't finished."]);
    expect(mergeBlockers(pullRequest({ state: "merged" }))).toEqual(["This is already live."]);
    expect(mergeBlockers(pullRequest({ state: "closed" }))).toEqual([
      "This review was closed, so it can't go live.",
    ]);
  });

  it("is blocked without a review", () => {
    expect(planGitIntent("putItLive", base)).toMatchObject({
      kind: "blocked",
      reason: "There's no review open yet. Send for review first.",
    });
  });
});

describe("describePullRequestState", () => {
  it.each([
    [{}, "Waiting for a reviewer", "neutral"],
    [{ isDraft: true }, "Draft — not sent to reviewers yet", "neutral"],
    [{ reviewDecision: "approved" }, "Approved — ready to put live", "good"],
    [{ reviewDecision: "changes-requested" }, "A reviewer asked for changes", "attention"],
    [{ checksState: "failing" }, "The automatic checks found problems", "bad"],
    [{ checksState: "pending" }, "Automatic checks are still running", "neutral"],
    [{ mergeability: "conflicting" }, "Clashes with newer changes — needs untangling first", "bad"],
    [{ state: "merged" }, "Live", "live"],
    [{ state: "closed" }, "Closed without going live", "neutral"],
  ] as const)("%j → %s", (fields, label, tone) => {
    const status = describePullRequestState(pullRequest({ ...fields }));
    expect(status.label).toBe(label);
    expect(status.tone).toBe(tone);
    expect(status.advanced).toMatch(/^Advanced: pull request t3\/booking-page → main/);
  });
});

describe("describeStackedResult", () => {
  it("narrates what actually happened", () => {
    const result = decodeStackedResult({
      action: "commit_push_pr",
      branch: { status: "created", name: "t3/booking-page" },
      commit: { status: "created", commitSha: "abc", subject: "Add a date picker" },
      push: { status: "pushed", branch: "t3/booking-page" },
      pr: { status: "created", url: "https://github.com/x/y/pull/12", number: 12 },
      toast: { title: "Done", cta: { kind: "none" } },
    });
    expect(describeStackedResult(result)).toBe(
      "Started a draft line (t3/booking-page), kept this version, uploaded it to the online copy and opened a review (#12).",
    );
  });

  it("says when there was nothing new", () => {
    const result = decodeStackedResult({
      action: "commit",
      branch: { status: "skipped_not_requested" },
      commit: { status: "skipped_no_changes" },
      push: { status: "skipped_not_requested" },
      pr: { status: "skipped_not_requested" },
      toast: { title: "Nothing", cta: { kind: "none" } },
    });
    expect(describeStackedResult(result)).toBe("Nothing new to keep.");
  });

  it("reads as one sentence when only the upload happened", () => {
    const result = decodeStackedResult({
      action: "commit_push",
      branch: { status: "skipped_not_requested" },
      commit: { status: "skipped_no_changes" },
      push: { status: "pushed", branch: "foreman/christmas-menu-3fa2" },
      pr: { status: "skipped_not_requested" },
      toast: { title: "Done", cta: { kind: "none" } },
    });
    expect(describeStackedResult(result)).toBe(
      "Nothing new to keep, so the latest kept version went up to the online copy.",
    );
  });
});
