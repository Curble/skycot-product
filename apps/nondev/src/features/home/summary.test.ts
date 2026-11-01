import { describe, expect, it } from "vite-plus/test";

import { homeRows, summarySentence, threadIdsWithoutOwner } from "./summary";

describe("summarySentence", () => {
  it("keeps the noun when only one kind of job exists", () => {
    expect(summarySentence(0, 1, 0, 3)).toBe("One job is waiting on you.");
    expect(summarySentence(0, 0, 2, 3)).toBe("2 jobs are ready to look at.");
  });

  it("says the noun once across several parts", () => {
    expect(summarySentence(1, 1, 0, 4)).toBe("One job is running, one is waiting on you.");
    expect(summarySentence(2, 0, 3, 9)).toBe("2 jobs are running, 3 are ready to look at.");
  });

  it("does not claim there is nothing while the Mac is unreachable", () => {
    expect(summarySentence(0, 0, 0, 0, false)).toMatch(/Waiting for your Mac/);
    expect(summarySentence(0, 0, 0, 0, true)).toMatch(/Nothing is on the go yet/);
  });

  it("uses child words for their things", () => {
    expect(summarySentence(1, 0, 0, 1, true, true)).toBe("One thing is being made.");
  });

  it("keeps a grown-up request separate from something waiting on the child", () => {
    expect(summarySentence(0, 1, 0, 2, true, true, 1)).toBe(
      "One thing is waiting on you, a grown-up needs to say yes.",
    );
  });

  it("counts failed rows that remain in Home's list", () => {
    expect(summarySentence(0, 1, 0, 2, true, true, 0, 1)).toBe(
      "One thing is waiting on you, one thing didn't work.",
    );
  });
});

describe("homeRows", () => {
  it("requests fresh ownership for live shell rows that arrived after the last today snapshot", () => {
    expect(
      threadIdsWithoutOwner([{ shell: { id: "known" } }, { shell: { id: "newly-waiting" } }], {
        known: "ava",
      }),
    ).toEqual(["newly-waiting"]);
  });

  it("keeps the Home counts aligned with live child rows and excludes sibling failures", () => {
    const rows = [
      {
        shell: { id: "mine" },
        at: "2026-10-27T12:00:00.000Z",
        status: { kind: "waiting", headline: "Waiting for you" },
      },
      {
        shell: { id: "old-plan" },
        at: "2026-10-25T12:00:00.000Z",
        status: { kind: "done", headline: "All done" },
      },
      {
        shell: { id: "fresh-plan" },
        at: "2026-10-27T11:00:00.000Z",
        status: { kind: "plan", headline: "Your plan is ready" },
      },
      {
        shell: { id: "sibling-error" },
        at: "2026-10-27T11:00:00.000Z",
        status: { kind: "failed", headline: "Something went wrong" },
      },
    ];
    const visible = homeRows(rows, true, "leo", {
      mine: "leo",
      "old-plan": "leo",
      "fresh-plan": "leo",
      "sibling-error": "ava",
    });
    expect(visible.map((row) => row.shell.id)).toEqual(["mine", "fresh-plan"]);
    expect(
      visible.filter((row) => row.status.kind === "waiting" || row.status.kind === "plan"),
    ).toHaveLength(2);
  });

  it("counts a live plan separately from a grown-up ask", () => {
    expect(summarySentence(0, 0, 0, 2, true, true, 1, 0, 1)).toBe(
      "A grown-up needs to say yes, Your plan is ready.",
    );
  });

  it("recomputes the ready count as soon as a new make is finished and owned", () => {
    const row = (id: string, kind: string) => ({
      shell: { id },
      status: { kind, headline: "" },
    });
    const before = homeRows([row("a", "ready"), row("b", "ready")], true, "leo", {
      a: "leo",
      b: "leo",
    });
    const after = homeRows([row("c", "ready"), row("a", "ready"), row("b", "ready")], true, "leo", {
      a: "leo",
      b: "leo",
      c: "leo",
    });
    expect(before.filter((r) => r.status.kind === "ready")).toHaveLength(2);
    expect(after.filter((r) => r.status.kind === "ready")).toHaveLength(3);
    // Until the owner is known the row is held back, which is what the re-ask fixes.
    expect(homeRows([row("c", "ready")], true, "leo", {}).length).toBe(0);
  });
});

describe("Your things pins", () => {
  it("lists only the child's own pinned things in the Pinned group", async () => {
    const { splitPinned } = await import("../tidy/pinned");
    const rows = [
      { shell: { id: "mine-a", pinnedAt: null } },
      { shell: { id: "mine-b", pinnedAt: "2026-11-01T00:00:00.000Z" } },
      { shell: { id: "sibling", pinnedAt: "2026-11-02T00:00:00.000Z" } },
    ].map((row) => ({ ...row, status: { kind: "ready", headline: "Done" } }));
    const mine = homeRows(rows, true, "kid-1", {
      "mine-a": "kid-1",
      "mine-b": "kid-1",
      sibling: "kid-2",
    });
    const { pinned, rest } = splitPinned(mine);
    expect(pinned.map((row) => row.shell.id)).toEqual(["mine-b"]);
    expect(rest.map((row) => row.shell.id)).toEqual(["mine-a"]);
  });
});
