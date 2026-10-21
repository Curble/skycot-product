import type {
  OrchestrationV2TurnItem,
  SourceControlProviderKind,
  ThreadPullRequestLink,
  VcsStatusResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSafetyCheck,
  collectCheckRuns,
  describePublishStatus,
  pickPullRequestLink,
  publishReadiness,
  resolveLiveChoice,
  resolveReviewChoice,
} from "./model";
import { describeTurnDiff } from "../../plain/changes";

function vcs(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/christmas-menu",
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "menu.html", insertions: 4, deletions: 1 }],
      insertions: 4,
      deletions: 1,
    },
    branchChanges: { baseRef: "main", insertions: 4, deletions: 1 },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    sourceControlProvider: {
      kind: "github" as SourceControlProviderKind,
      name: "GitHub",
      baseUrl: "https://github.com",
    },
    ...overrides,
  };
}

function link(overrides: Partial<ThreadPullRequestLink["snapshot"]> = {}): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "fern/cafe",
    number: 14,
    url: "https://github.com/fern/cafe/pull/14",
    source: "created",
    linkedAt: "2026-10-21T08:00:00.000Z",
    stack: null,
    snapshot: {
      state: "open",
      title: "Christmas menu",
      headBranch: "feature/christmas-menu",
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-10-21T08:00:00.000Z",
      ...overrides,
    },
  };
}

describe("resolveReviewChoice", () => {
  it("never pushes the live line: a clean tree on main is blocked, a dirty one moves to a draft line", () => {
    const base = { cwd: "/p", link: null, connection: "connected" as const };
    const dirty = resolveReviewChoice({
      ...base,
      vcs: vcs({ isDefaultRef: true, refName: "main", branchChanges: undefined }),
    });
    expect(dirty.kind).toBe("review");
    if (dirty.kind === "review") {
      expect(dirty.plan.input.action).toBe("commit_push_pr");
      expect(dirty.plan.input.featureBranch).toBe(true);
      expect(dirty.guard).toContain("draft line");
    }
    const clean = resolveReviewChoice({
      ...base,
      vcs: vcs({
        isDefaultRef: true,
        refName: "main",
        hasWorkingTreeChanges: false,
        aheadCount: 2,
      }),
    });
    expect(clean.kind).toBe("blocked");
  });

  it("degrades to keeping a version on this Mac when there is no remote", () => {
    const choice = resolveReviewChoice({
      cwd: "/p",
      link: null,
      connection: "no-remote",
      vcs: vcs({ hasPrimaryRemote: false, sourceControlProvider: undefined }),
    });
    expect(choice.kind).toBe("keep");
    if (choice.kind === "keep") expect(choice.plan.input.action).toBe("commit");
  });

  it("uploads without opening a review when the remote is not GitHub", () => {
    const choice = resolveReviewChoice({
      cwd: "/p",
      link: null,
      connection: "remote-not-github",
      vcs: vcs({ sourceControlProvider: undefined }),
    });
    expect(choice.kind).toBe("review");
    if (choice.kind === "review") {
      expect(choice.opensReview).toBe(false);
      expect(choice.plan.input.action).toBe("commit_push");
      expect(choice.explainer).toContain("GitHub isn't connected");
    }
  });
});

describe("resolveLiveChoice", () => {
  it("is blocked until the review is approved, then merges by squash", () => {
    const waiting = resolveLiveChoice({
      link: link(),
      detail: null,
      connection: "connected",
      scripts: [],
      canWrite: true,
    });
    expect(waiting.kind).toBe("blocked");
    const approved = resolveLiveChoice({
      link: link({ reviewDecision: "approved", checksState: "passing", mergeability: "mergeable" }),
      detail: null,
      connection: "connected",
      scripts: [],
      canWrite: true,
    });
    expect(approved.kind).toBe("merge");
    if (approved.kind === "merge") {
      expect(approved.plan.method).toBe("squash");
      expect(approved.canTakeBack).toBe(false);
    }
  });

  it("explains that there is no way live without a review or a publish script", () => {
    const choice = resolveLiveChoice({
      link: null,
      detail: null,
      connection: "no-remote",
      scripts: [],
      canWrite: true,
    });
    expect(choice.kind).toBe("blocked");
    if (choice.kind === "blocked") expect(choice.reason).toContain("no publish script");
  });
});

describe("describePublishStatus", () => {
  it("names the reviewer while waiting and the time once live", () => {
    expect(
      describePublishStatus({
        link: link(),
        reviewers: [{ login: "sam", name: "Sam Lee" }],
        hasSomethingToPublish: true,
      })?.label,
    ).toBe("Waiting for Sam Lee");
    expect(
      describePublishStatus({
        link: link({ reviewDecision: "approved" }),
        hasSomethingToPublish: true,
      })?.label,
    ).toBe("Approved · ready to go live");
    expect(
      describePublishStatus({
        link: link({ state: "merged", mergedAt: "2026-10-21T08:47:00.000Z" }),
        hasSomethingToPublish: false,
        formatTime: () => "8:47 am",
      })?.label,
    ).toBe("Live · 8:47 am");
    expect(describePublishStatus({ link: null, hasSomethingToPublish: true })?.label).toBe(
      "Not live yet",
    );
    expect(describePublishStatus({ link: null, hasSomethingToPublish: false })).toBeNull();
  });

  it("prefers the open review over an older merged one", () => {
    const merged = {
      ...link({ state: "merged" }),
      number: 9,
      linkedAt: "2026-10-20T00:00:00.000Z",
    };
    expect(pickPullRequestLink([merged, link()])?.number).toBe(14);
  });
});

describe("publishReadiness", () => {
  it("waits for the work to finish and for something to publish", () => {
    expect(
      publishReadiness({ vcs: vcs(), link: null, active: true, canOperate: true }).enabled,
    ).toBe(false);
    expect(
      publishReadiness({
        vcs: vcs({
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
        link: null,
        active: false,
        canOperate: true,
      }).reason,
    ).toContain("Nothing to publish");
    expect(
      publishReadiness({ vcs: vcs(), link: null, active: false, canOperate: true }).enabled,
    ).toBe(true);
  });
});

describe("buildSafetyCheck", () => {
  const diff = [
    "diff --git a/menu.html b/menu.html",
    "--- a/menu.html",
    "+++ b/menu.html",
    "+<h2>Christmas</h2>",
    "diff --git a/.env b/.env",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/.env",
    "+KEY=1",
  ].join("\n");

  it("flags secrets and says 'Not checked' instead of guessing", () => {
    const { lines, summary } = buildSafetyCheck({
      changes: { conversation: describeTurnDiff(diff), outsideConversation: [], pending: false },
      checkRuns: [],
      operationsKnown: true,
    });
    expect(lines.map((line) => line.state)).toEqual(["ok", "ok", "warn", "unknown"]);
    expect(lines[2]!.text).toContain("Settings or secret files");
    expect(lines[3]!.text).toContain("Not checked");
    expect(summary).toBe("1 note · 1 not checked");
  });

  it("only claims checks passed when a test or build ran and exited cleanly", () => {
    const item = (input: string, exitCode: number): OrchestrationV2TurnItem =>
      ({
        type: "command_execution",
        id: `item-${input}`,
        threadId: "t",
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "completed",
        input,
        exitCode,
      }) as unknown as OrchestrationV2TurnItem;
    const passed = collectCheckRuns([item("npm test", 0), item("ls -la", 0)]);
    expect(passed).toHaveLength(1);
    expect(passed[0]!.outcome).toBe("passed");
    const failed = collectCheckRuns([item("npm run build", 1)]);
    expect(failed[0]!.outcome).toBe("failed");
    const check = buildSafetyCheck({
      changes: { conversation: describeTurnDiff(diff), outsideConversation: [], pending: false },
      checkRuns: failed,
      operationsKnown: true,
    });
    expect(check.lines.at(-1)!.state).toBe("fail");
  });
});
