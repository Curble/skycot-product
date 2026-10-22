import { describe, expect, it } from "vite-plus/test";

import {
  fridgeOrder,
  fridgeShelves,
  homeMagnets,
  madeLabel,
  parseFridge,
  type FridgeItem,
} from "./fridge";

const item = (threadId: string, overrides: Partial<FridgeItem> = {}): FridgeItem => ({
  threadId,
  projectId: "project:games",
  title: threadId,
  childId: "ava",
  madeAt: 100,
  page: "index.html",
  cwd: "/Users/kid/games",
  pinnedAt: null,
  ...overrides,
});

describe("the family fridge", () => {
  const items = [
    item("rocket", { madeAt: 300 }),
    item("maze", { madeAt: 200, pinnedAt: 50 }),
    item("robot", { childId: "leo", madeAt: 400 }),
    item("cards", { madeAt: 100, pinnedAt: 90 }),
    item("old", { childId: null, madeAt: 10 }),
  ];

  it("puts pinned magnets first, newest pin first, then the newest made", () => {
    expect(fridgeOrder(items).map((entry) => entry.threadId)).toEqual([
      "cards",
      "maze",
      "robot",
      "rocket",
      "old",
    ]);
  });

  it("gives every child a shelf, siblings included, and filters to one", () => {
    const shelves = fridgeShelves(items, ["ava", "leo", "mia"]);
    expect(
      shelves.map((shelf) => [shelf.childId, shelf.items.map((entry) => entry.threadId)]),
    ).toEqual([
      ["ava", ["cards", "maze", "rocket"]],
      ["leo", ["robot"]],
      ["mia", []],
      [null, ["old"]],
    ]);
    expect(fridgeShelves(items, ["ava", "leo"], "leo").map((shelf) => shelf.childId)).toEqual([
      "leo",
    ]);
  });

  it("shows three on Home", () => {
    expect(homeMagnets(items).map((entry) => entry.threadId)).toEqual(["cards", "maze", "robot"]);
  });

  it("dates a magnet the way a person would", () => {
    const now = Date.parse("2026-10-22T18:00:00");
    expect(madeLabel(Date.parse("2026-10-22T09:00:00"), now)).toBe("Made today");
    expect(madeLabel(Date.parse("2026-10-21T09:00:00"), now)).toBe("Made yesterday");
    expect(madeLabel(Date.parse("2026-10-14T09:00:00"), now)).toBe("Made 14 Oct");
  });

  it("keeps only magnets it can show", () => {
    expect(
      parseFridge({ items: [item("ok"), { threadId: "broken" }] })?.map((entry) => entry.threadId),
    ).toEqual(["ok"]);
    expect(parseFridge({ error: "x" })).toBeNull();
  });
});
