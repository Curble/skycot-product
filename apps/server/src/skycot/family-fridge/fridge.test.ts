// nondev-seam: skycot-iphone-q50-fridge-title-test
// nondev-seam: skycot-q51-fridge-svg-test
import { describe, expect, it } from "@effect/vitest";

import { fridgeItems, fridgePageTitle, fridgeSvgThumbnail, type FridgeThread } from "./fridge.ts";

describe("fridge page titles", () => {
  it("uses a page title or first heading and cleans up its text", () => {
    expect(fridgePageTitle("<title> A &amp; B </title><h1>Later</h1>")).toBe("A & B");
    expect(fridgePageTitle("<h1>Hello <em>there</em></h1>")).toBe("Hello there");
    expect(fridgePageTitle("<p>No heading</p>")).toBeNull();
  });
});

describe("fridge SVG thumbnails", () => {
  it("draws safe title, heading, dominant CSS color and a kind mark without page code", () => {
    const svg = fridgeSvgThumbnail(
      "<title>Quiz &amp; fun</title><h1>Big quiz</h1><style>body{background:#123456} .a{color:#123456}</style><script>alert(1)</script>",
      "Fallback",
    );
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain("Quiz &amp; fun");
    expect(svg).toContain("Big quiz");
    expect(svg).toContain(">?</text>");
    expect(svg).not.toContain("alert(1)");
  });
});

const file = (path: string, kind = "modified") => ({ path, kind, additions: 1, deletions: 0 });

const thread = (overrides: Partial<FridgeThread> & { threadId: string }): FridgeThread => ({
  projectId: "project:games",
  title: overrides.threadId,
  cwd: "/Users/kid/games",
  deleted: false,
  checkpoints: [],
  runs: [],
  ...overrides,
});

describe("fridgeItems", () => {
  const threads = [
    thread({
      threadId: "rocket",
      checkpoints: [
        { runId: "r1", capturedAt: 100, files: [file("rocket.html")] },
        { runId: "r2", capturedAt: 200, files: [file("index.html")] },
        { runId: "r3", capturedAt: 300, files: [file("index.html")] },
      ],
      runs: [
        { id: "r1", status: "completed" },
        { id: "r2", status: "completed" },
        { id: "r3", status: "rolled_back" },
      ],
    }),
    thread({
      threadId: "styles-only",
      checkpoints: [{ runId: null, capturedAt: 400, files: [file("style.css")] }],
    }),
    thread({
      threadId: "maze",
      checkpoints: [{ runId: null, capturedAt: 250, files: [file("maze.html")] }],
    }),
    thread({
      threadId: "gone",
      deleted: true,
      checkpoints: [{ runId: null, capturedAt: 500, files: [file("index.html")] }],
    }),
    thread({
      threadId: "deleted-page",
      checkpoints: [{ runId: null, capturedAt: 600, files: [file("index.html", "deleted")] }],
    }),
  ];

  it("puts up one magnet per conversation that made a page, newest first", () => {
    const items = fridgeItems(threads, { rocket: "ava", maze: "leo" }, { maze: 900 });
    expect(items.map((item) => [item.threadId, item.page, item.madeAt])).toEqual([
      ["maze", "maze.html", 250],
      // An undone change is not the page on the fridge; the kept one before it is.
      ["rocket", "index.html", 200],
    ]);
    expect(items.map((item) => [item.childId, item.pinnedAt])).toEqual([
      ["leo", 900],
      ["ava", null],
    ]);
  });

  it("follows a later checkpoint when the conversation replaces its page", () => {
    const replaced = thread({
      threadId: "replaced",
      checkpoints: [
        { runId: "r1", capturedAt: 100, files: [file("bounce.html")] },
        { runId: "r2", capturedAt: 200, files: [file("birthday-card.html")] },
      ],
      runs: [
        { id: "r1", status: "completed" },
        { id: "r2", status: "completed" },
      ],
    });
    expect(fridgeItems([replaced], {}, {})[0]?.page).toBe("birthday-card.html");
  });
});
