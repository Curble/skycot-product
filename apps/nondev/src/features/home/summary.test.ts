import { describe, expect, it } from "vite-plus/test";

import { homeRows, summarySentence } from "./summary";

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
});
