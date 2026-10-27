import { describe, expect, it } from "vite-plus/test";

import { checkpoint } from "../../plain/fixtures.test-helpers";
import { buildVersionsTimeline } from "../../plain/versions";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import {
  buildTimeline,
  decorateTimeline,
  START_LABEL,
  timelineLabel,
  timelineTitle,
  UNDONE_BLOCKER,
} from "./timeline";

const at = (minute: number) => `2026-10-21T09:${String(minute).padStart(2, "0")}:00.000Z`;
const start = checkpoint({ id: "c0", ordinalWithinScope: 0, capturedAt: at(0), files: [] });
const gap = checkpoint({ id: "c0b", ordinalWithinScope: 1, capturedAt: at(1), files: [] });
const one = checkpoint({ id: "c1", ordinalWithinScope: 2, capturedAt: at(5) });
const two = checkpoint({
  id: "c2",
  ordinalWithinScope: 3,
  capturedAt: at(10),
  files: [{ path: "menu.html", kind: "M", additions: 2, deletions: 1 }],
});

describe("child version words", () => {
  it("uses tries and hides line counts", () => {
    expect(timelineTitle(2, "Changed 1 file (+118 / −15 lines)", true)).toBe("Try 2");
    expect(timelineLabel("Changed 1 file (+118 / −15 lines)", true)).toBe("Changed 1 file");
    expect(timelineTitle(2, "Changed 1 file", false)).toBe("Version 2");
    expect(timelineLabel("Changed 1 file (+118 / −15 lines)", false)).toContain("+118");
  });
});

describe("decorateTimeline", () => {
  it("collapses empty points to one start line and numbers only real versions", () => {
    const { entries, byId } = decorateTimeline(buildVersionsTimeline([start, gap, one, two]), []);
    expect(entries.map((e) => [e.number, e.label])).toEqual([
      [3, "Changed 1 file: 1 page (+2 / −1 lines)"],
      [2, "Changed 1 file: 1 page (+12 / −3 lines)"],
      [1, START_LABEL],
    ]);
    // The hidden empty point borrows the start line's number for Undo sheets.
    expect(byId.get("c0b")?.number).toBe(1);
    expect(byId.get("c0b")?.label).toBe(START_LABEL);
    // …and its time, so the Undo sheet's "Version 1 (time)" matches the rail (QA-P2-3-01).
    expect(byId.get("c0b")?.timestamp).toBe(at(0));
  });

  it("folds a kept version into its restore point and blocks restores past it", () => {
    const kept = [
      { sha: "272f0c4abc", subject: "Change the footer", at: at(6), checkpointId: "c1" },
    ];
    const { entries } = decorateTimeline(
      buildVersionsTimeline([start, one, two], { commits: kept }),
      kept,
    );
    expect(entries.filter((e) => e.kind === "kept version")).toHaveLength(0);
    const v2 = entries.find((e) => e.id === "c1")!;
    expect(v2.kept?.sha).toBe("272f0c4abc");
    expect(v2.number).toBe(2);
    const v1 = entries.find((e) => e.id === "c0")!;
    expect(v1.canRestore).toBe(false);
    expect(v1.restoreExplainer.blockedBecause).toMatch(
      /Version 2 was kept as a Git commit \(272f0c4\)/,
    );
    expect(v1.restore).toBeUndefined();
    // The kept point itself can still be restored to (it only undoes later, unkept work).
    expect(v2.canRestore).toBe(true);
  });

  it("calls a stale point undone, never changed outside the app", () => {
    const stale = checkpoint({
      id: "c2",
      ordinalWithinScope: 3,
      capturedAt: at(10),
      status: "stale",
      files: [{ path: "menu.html", kind: "M", additions: 2, deletions: 1 }],
    });
    const { entries } = decorateTimeline(buildVersionsTimeline([start, one, stale]), []);
    const undone = entries.find((e) => e.id === "c2")!;
    expect(undone.undone).toBe(true);
    expect(undone.restoreExplainer.blockedBecause).toBe(UNDONE_BLOCKER);
    expect(undone.canRestore).toBe(false);
  });

  it("shows nothing when no version changed files", () => {
    expect(decorateTimeline(buildVersionsTimeline([start, gap]), []).entries).toEqual([]);
  });

  it("keeps an undone point's row and number after the engine prunes it (QA-P2-3-07)", () => {
    const three = checkpoint({
      id: "c3",
      ordinalWithinScope: 4,
      capturedAt: at(20),
      files: [{ path: "book.html", kind: "M", additions: 1, deletions: 1 }],
    });
    const projection = {
      checkpoints: [start, one, three],
      checkpointScopes: [{ id: "scope-root", kind: "root_run" }],
    } as unknown as OrchestrationV2ThreadProjection;
    const undone = [
      {
        id: "c2",
        label: "Changed 1 file: 1 page (+2 / −1 lines)",
        timestamp: at(10),
        fileCount: 1,
        technical: "checkpoint c2",
      },
    ];
    const timeline = buildTimeline(projection, { worktreePath: "/w" } as never, [], undone);
    expect(timeline.entries.map((e) => [e.id, e.number, e.undone])).toEqual([
      ["c3", 4, false],
      ["c2", 3, true],
      ["c1", 2, false],
      ["c0", 1, false],
    ]);
  });
});
