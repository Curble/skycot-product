// nondev-seam: skycot-iphone-q50-fridge-client-test
import { describe, expect, it } from "vite-plus/test";

import {
  fridgeOrder,
  childFridgeTitle,
  fridgeIcon,
  fridgeShelves,
  homeMagnets,
  madeLabel,
  parseFridge,
  type FridgeItem,
} from "./fridge";
import { parseMagnetPage } from "./pages";

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

  it("keeps the live page hash when an engine sends one", () => {
    expect(
      parseFridge({ items: [item("changed", { contentHash: "sha256-a" })] })?.[0]?.contentHash,
    ).toBe("sha256-a");
    expect(parseFridge({ items: [item("older-engine")] })?.[0]?.contentHash).toBeUndefined();
  });

  it("accepts a static SVG card from the engine", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Rocket</text></svg>';
    expect(parseFridge({ items: [item("svg", { thumbnailSvg: svg })] })?.[0]?.thumbnailSvg).toBe(
      svg,
    );
  });

  it("repairs generic and cut magnet names and chooses a kind icon", () => {
    const madeAt = Date.parse("2026-10-27T09:00:00Z");
    expect(childFridgeTitle({ title: "Page", madeAt }, "Ava")).toBe("Ava's page · 27 Oct");
    expect(childFridgeTitle({ title: "A birthday card page for", madeAt }, "Ava")).toBe(
      "Ava's page · 27 Oct",
    );
    expect(childFridgeTitle({ title: "Birthday card for m", madeAt }, "Ava")).toBe(
      "Ava's page · 27 Oct",
    );
    expect(childFridgeTitle({ title: "Bounce game", madeAt }, "Ava")).toBe("Bounce game");
    expect(fridgeIcon("Quiz time", "index.html")).toBe("questionmark.square.fill");
    expect(fridgeIcon("Birthday card", "card.html")).toBe("gift.fill");
    expect(fridgeIcon("Bounce", "bounce.html")).toBe("gamecontroller.fill");
    expect(fridgeIcon("Poster", "index.html")).toBe("doc.richtext.fill");
  });
});

describe("a magnet's page", () => {
  it("reads the page, or that it is gone, and nothing else", () => {
    expect(parseMagnetPage({ html: "<p>hi</p>" })).toEqual({ html: "<p>hi</p>" });
    expect(parseMagnetPage({ html: null })).toEqual({ html: null });
    expect(parseMagnetPage({})).toBeNull();
    expect(parseMagnetPage({ html: 3 })).toBeNull();
  });
});
