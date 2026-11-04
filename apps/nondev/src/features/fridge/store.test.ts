import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { FridgeItem } from "./fridge";

const pending: Array<(items: ReadonlyArray<FridgeItem>) => void> = [];
vi.mock("../family/api", () => ({
  request: () =>
    new Promise((resolve) => {
      pending.push((items) => resolve({ ok: true, value: items }));
    }),
}));

const { fridgeSnapshot, pinMagnet, refreshFridge, resetFridgeForTests } = await import("./store");

const magnet = (threadId: string): FridgeItem => ({
  threadId,
  projectId: "project:games",
  title: threadId,
  childId: "ava",
  madeAt: 100,
  page: "index.html",
  cwd: "/Users/kid/games",
  pinnedAt: null,
});

const shown = fridgeSnapshot;

afterEach(() => {
  pending.length = 0;
  resetFridgeForTests();
});

describe("the fridge store", () => {
  it("drops an older answer that arrives after a newer one", async () => {
    const first = refreshFridge();
    const second = refreshFridge();
    pending[1]!([magnet("a"), magnet("b"), magnet("c"), magnet("d")]);
    await second;
    pending[0]!([magnet("a")]);
    await first;
    expect(shown().items.map((item) => item.threadId)).toEqual(["a", "b", "c", "d"]);
    expect(shown().loaded).toBe(true);
  });

  it("does not let a refresh asked before a pin undo the pin", async () => {
    const before = refreshFridge();
    const pin = pinMagnet("a", true);
    pending[1]!([{ ...magnet("a"), pinnedAt: 5 }]);
    await pin;
    pending[0]!([magnet("a")]);
    await before;
    expect(shown().items[0]?.pinnedAt).toBe(5);
  });
});
