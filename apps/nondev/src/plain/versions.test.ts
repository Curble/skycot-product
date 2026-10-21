import { describe, expect, it } from "vite-plus/test";

import { checkpoint } from "./fixtures.test-helpers";
import { buildVersionsTimeline, describeCheckpoint, restoreConfirmation } from "./versions";

describe("describeCheckpoint", () => {
  it("labels a restore point from the plain change note and offers the rollback payload", () => {
    const entry = describeCheckpoint(checkpoint());
    expect(entry).toMatchObject({
      id: "ckpt-1",
      kind: "restore point",
      kindLabel: "Restore point",
      label: "Changed 1 file: 1 page (+12 / −3 lines)",
      timestamp: "2026-10-21T09:30:00.000Z",
      fileCount: 1,
      canRestore: true,
      restore: {
        type: "checkpoint.rollback",
        scopeId: "scope-root",
        checkpointId: "ckpt-1",
        restoreFiles: true,
      },
      isCurrent: false,
    });
    expect(entry.technical).toContain("refs/t3/checkpoints/ckpt-1");
    expect(entry.restoreExplainer.does).toHaveLength(2);
    expect(entry.restoreExplainer.doesNot).toHaveLength(4);
    expect(entry.restoreExplainer.does[0]).toMatch(/^Puts every file/);
    // The engine takes no fresh restore point before restoring; the copy must not promise one.
    expect(entry.restoreExplainer.does.join(" ")).not.toMatch(/restore point first/);
    expect(entry.restoreExplainer.doesNot[1]).toMatch(/database/);
    expect(entry.restoreExplainer.doesNot[3]).toMatch(/Can't itself be undone/);
    expect(entry.restoreExplainer.blockedBecause).toBeUndefined();
  });

  it("blocks restore for missing, stale and shared-folder checkpoints with a reason", () => {
    expect(describeCheckpoint(checkpoint({ status: "missing" }))).toMatchObject({
      canRestore: false,
      restoreExplainer: {
        blockedBecause: "This restore point is no longer on disk, so it can't be restored.",
      },
    });
    expect(
      describeCheckpoint(checkpoint({ status: "stale" })).restoreExplainer.blockedBecause,
    ).toMatch(/restored to an earlier point/);
    expect(describeCheckpoint(checkpoint(), { canRollbackFiles: false })).toMatchObject({
      canRestore: false,
      restoreExplainer: { blockedBecause: expect.stringMatching(/shared/) },
    });
    expect(describeCheckpoint(checkpoint({ status: "missing" })).restore).toBeUndefined();
  });

  it("never offers to restore the current point to itself", () => {
    const entry = describeCheckpoint(checkpoint(), {}, true);
    expect(entry.canRestore).toBe(false);
    expect(entry.isCurrent).toBe(true);
    expect(entry.restore).toBeDefined();
  });

  it("labels an empty checkpoint plainly", () => {
    expect(describeCheckpoint(checkpoint({ files: [] })).label).toBe(
      "No file changes at this point",
    );
  });
});

describe("buildVersionsTimeline", () => {
  const older = checkpoint({
    id: "ckpt-1",
    ordinalWithinScope: 1,
    capturedAt: "2026-10-21T09:00:00.000Z",
  });
  const newer = checkpoint({
    id: "ckpt-2",
    ordinalWithinScope: 2,
    capturedAt: "2026-10-21T09:30:00.000Z",
    files: [{ path: "styles/app.css", kind: "M", additions: 1, deletions: 1 }],
  });
  const toolScope = checkpoint({
    id: "ckpt-tool",
    scopeId: "scope-tool",
    capturedAt: "2026-10-21T09:15:00.000Z",
  });

  it("sorts newest first and marks the newest ready checkpoint as current", () => {
    const timeline = buildVersionsTimeline([older, newer]);
    expect(timeline.map((e) => [e.id, e.isCurrent, e.canRestore])).toEqual([
      ["ckpt-2", true, false],
      ["ckpt-1", false, true],
    ]);
  });

  it("hides non-root scopes when asked", () => {
    expect(buildVersionsTimeline([older, newer, toolScope]).map((e) => e.id)).toEqual([
      "ckpt-2",
      "ckpt-tool",
      "ckpt-1",
    ]);
    expect(
      buildVersionsTimeline(
        [older, newer, toolScope],
        {},
        { rootScopeIds: new Set(["scope-root"]) },
      ).map((e) => e.id),
    ).toEqual(["ckpt-2", "ckpt-1"]);
  });

  it("interleaves kept versions and live markers by time", () => {
    const timeline = buildVersionsTimeline([older, newer], {
      commits: [
        { sha: "abcdef1234567890", subject: "Add booking page", at: "2026-10-21T09:10:00.000Z" },
      ],
      live: [
        {
          id: "pr-12",
          label: "Review #12 went live",
          at: "2026-10-21T10:00:00.000Z",
          url: "https://github.com/x/y/pull/12",
        },
      ],
    });
    expect(timeline.map((e) => [e.kind, e.id])).toEqual([
      ["live", "pr-12"],
      ["restore point", "ckpt-2"],
      ["kept version", "abcdef1234567890"],
      ["restore point", "ckpt-1"],
    ]);
    const kept = timeline[2]!;
    expect(kept).toMatchObject({
      kindLabel: "Kept version",
      label: "Add booking page",
      canRestore: false,
      technical: "git commit abcdef1234",
    });
    expect(timeline[0]!.technical).toBe("https://github.com/x/y/pull/12");
  });

  it("writes the restore confirmation with the formatted time", () => {
    const [entry] = buildVersionsTimeline([older]);
    expect(restoreConfirmation(entry!, () => "9:00 am today")).toBe(
      "You'll lose changes made after 9:00 am today. They stay in the chat.",
    );
  });
});
