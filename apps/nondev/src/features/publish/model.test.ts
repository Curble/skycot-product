import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2TurnItem,
  SourceControlProviderKind,
  ThreadPullRequestLink,
  VcsStatusResult,
  RunId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  areaFileNoun,
  buildSafetyCheck,
  collectCheckRuns,
  describeFailure,
  describePublishStatus,
  pickPullRequestLink,
  publishReadiness,
  resolveLiveChoice,
  resolveReviewChoice,
  latestTurnCount,
  uploadedTurnCount,
  uploadReversesOnline,
  uploadStillCurrent,
} from "./model";
import { checkpoint as checkpointFixture } from "../../plain/fixtures.test-helpers";
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

describe("latestTurnCount", () => {
  const checkpoint = (runId: string, appRunOrdinal: number) =>
    ({ runId, appRunOrdinal }) as unknown as OrchestrationV2Checkpoint;
  const run = (id: string, status: "rolled_back") => ({ id: id as RunId, status });
  it("skips turns the user undid, since the engine rolled the thread back past them", () => {
    const checkpoints = [checkpoint("run-1", 1), checkpoint("run-2", 2)];
    expect(latestTurnCount(checkpoints)).toBe(2);
    expect(latestTurnCount(checkpoints, [run("run-2", "rolled_back")])).toBe(1);
    expect(
      latestTurnCount(checkpoints, [run("run-1", "rolled_back"), run("run-2", "rolled_back")]),
    ).toBeNull();
  });
});

describe("describeFailure", () => {
  const pushError = new Error(
    "Git command failed in GitVcsDriver.pushCurrentBranch.pushWithUpstream (/tmp/wt): Git command exited with a non-zero status. (remote_unreachable)",
  );
  it("names the online copy, not GitHub, when the remote is a folder", () => {
    const failure = describeFailure(pushError, { remote: "other" });
    expect(failure.headline).toBe("The online copy didn't respond.");
    expect(failure.hint).toMatch(/Nothing was lost/);
    expect(failure.detail).toContain("remote_unreachable");
  });
  it("names GitHub when the remote is GitHub", () => {
    expect(describeFailure(pushError, { remote: "github" }).headline).toBe(
      "GitHub didn't respond.",
    );
  });
  it("names the version-description step when the assistant did not answer", () => {
    const failure = describeFailure(
      new Error(
        "Text generation failed in generateCommitMessage: Codex CLI command failed: remote",
      ),
      { remote: "other" },
    );
    expect(failure.headline).toMatch(/description for this version/);
  });
  it("keeps permission problems and unknown failures plain", () => {
    expect(describeFailure(new Error("missing scope: source-control:write")).headline).toMatch(
      /isn't allowed/,
    );
    expect(describeFailure(new Error("boom")).headline).toBe("That didn't work.");
  });
});

describe("areaFileNoun", () => {
  it("says 'settings file' like the card does", () => {
    expect(areaFileNoun("settings", 1)).toBe("settings file");
    expect(areaFileNoun("pages", 4)).toBe("pages");
    expect(areaFileNoun("behind the scenes", 2)).toBe("files behind the scenes");
  });
});

describe("buildSafetyCheck reversal note", () => {
  it("warns when the upload would carry the undoing of a kept version", () => {
    const { lines } = buildSafetyCheck({
      changes: {
        conversation: describeTurnDiff(
          "diff --git a/menu.html b/menu.html\n--- a/menu.html\n+++ b/menu.html\n@@ -1 +1 @@\n-a\n+b\n",
        ),
        outsideConversation: [],
        pending: false,
      },
      checkRuns: [],
      operationsKnown: true,
      reversedKept: [{ subject: "Change the footer email", number: 3 }],
    });
    const note = lines.find((line) => /already kept/.test(line.text));
    expect(note?.state).toBe("warn");
    expect(note?.detail).toContain("Version 3: Change the footer email");
  });
});

describe("uploadStillCurrent", () => {
  it("is true only while nothing has changed since the upload", () => {
    const upload = { at: "2026-10-21T10:00:00.000Z" };
    expect(
      uploadStillCurrent(vcs({ hasWorkingTreeChanges: false, aheadCount: 0 }), upload, null),
    ).toBe(true);
    expect(uploadStillCurrent(vcs({ hasWorkingTreeChanges: true }), upload, null)).toBe(false);
    expect(
      uploadStillCurrent(
        vcs({ hasWorkingTreeChanges: false, aheadCount: 0 }),
        upload,
        "2026-10-21T10:05:00.000Z",
      ),
    ).toBe(false);
    expect(uploadStillCurrent(vcs(), null, null)).toBe(false);
  });
});

describe("describePublishStatus after an upload", () => {
  it("says Uploaded with the time, with an Advanced-prefixed tooltip", () => {
    const status = describePublishStatus({
      link: null,
      hasSomethingToPublish: true,
      uploadedAt: "2026-10-21T10:00:00.000Z",
      formatTime: () => "8:00 pm",
    });
    expect(status?.label).toBe("Uploaded · 8:00 pm");
    expect(status?.advanced).toMatch(/^Advanced:/);
    expect(describePublishStatus({ link: null, hasSomethingToPublish: true })?.advanced).toMatch(
      /^Advanced:/,
    );
  });
});

describe("measuring an upload against the online copy (QA-P2-3-05)", () => {
  const edit = (path: string) =>
    describeTurnDiff(
      `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`,
    );

  it("finds the turn the last upload carried", () => {
    const checkpoints = [
      checkpointFixture({
        id: "c1",
        runId: "run-1",
        appRunOrdinal: 1,
        capturedAt: "2026-10-21T09:00:00.000Z",
      }),
      checkpointFixture({
        id: "c2",
        runId: "run-2",
        appRunOrdinal: 2,
        capturedAt: "2026-10-21T09:10:00.000Z",
      }),
    ];
    expect(uploadedTurnCount(checkpoints, [], "2026-10-21T09:05:00.000Z")).toBe(1);
    expect(uploadedTurnCount(checkpoints, [], "2026-10-21T09:20:00.000Z")).toBe(2);
    expect(uploadedTurnCount(checkpoints, [], null)).toBeNull();
    expect(uploadedTurnCount(checkpoints, [], "2026-10-21T08:00:00.000Z")).toBeNull();
  });

  it("says the upload reverses what's online when the conversation nets to nothing", () => {
    const sinceUpload = edit("index.html");
    expect(uploadReversesOnline(sinceUpload, describeTurnDiff(""))).toBe(true);
    expect(uploadReversesOnline(sinceUpload, edit("index.html"))).toBe(false);
    expect(uploadReversesOnline(null, describeTurnDiff(""))).toBe(false);
  });
});
