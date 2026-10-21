import { describe, expect, it } from "vite-plus/test";

import { checkpoint } from "../../plain/fixtures.test-helpers";
import { buildVersionsTimeline } from "../../plain/versions";
import { decorateTimeline, START_LABEL, UNDONE_BLOCKER } from "./timeline";

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
});
