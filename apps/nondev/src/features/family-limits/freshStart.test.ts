import { describe, expect, it } from "vite-plus/test";

import { clearCachedEngineData, markFreshStart, takeFreshStart } from "./freshStart";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

describe("fresh start when the picker moves to another child", () => {
  it("the mark is read once, then spent", () => {
    const storage = memoryStorage();
    expect(takeFreshStart(storage)).toBe(false);
    markFreshStart(storage);
    expect(takeFreshStart(storage)).toBe(true);
    expect(takeFreshStart(storage)).toBe(false);
  });

  it("deletes the engine cache only when marked, and resolves on success, error or block", async () => {
    const storage = memoryStorage();
    const deleted: string[] = [];
    const fakeDelete = (outcome: "onsuccess" | "onerror" | "onblocked") => (name: string) => {
      deleted.push(name);
      const request = {} as IDBOpenDBRequest & Record<string, () => void>;
      setTimeout(() => request[outcome]?.({} as never), 0);
      return request;
    };
    await clearCachedEngineData(fakeDelete("onsuccess"), storage);
    expect(deleted).toEqual([]);
    for (const outcome of ["onsuccess", "onerror", "onblocked"] as const) {
      markFreshStart(storage);
      await clearCachedEngineData(fakeDelete(outcome), storage);
    }
    expect(deleted).toEqual(Array(3).fill("t3code:connection-runtime"));
  });

  it("starts the app anyway when there is no database", async () => {
    const storage = memoryStorage();
    markFreshStart(storage);
    await clearCachedEngineData(() => null, storage);
    expect(takeFreshStart(storage)).toBe(false);
  });
});

describe("pickRestartsFresh", () => {
  it("restarts for another child, and for the same child after a grown-up's turn", async () => {
    const { pickRestartsFresh } = await import("./freshStart");
    expect(pickRestartsFresh("a", "b", false)).toBe(true);
    expect(pickRestartsFresh("a", "a", true)).toBe(true);
    expect(pickRestartsFresh("a", "a", false)).toBe(false);
    expect(pickRestartsFresh(null, "a", false)).toBe(false);
  });
});

describe("grownUpTurnRestarts", () => {
  it("restarts the first grown-up turn, but never while the welcome steps are open", async () => {
    const { grownUpTurnRestarts } = await import("./freshStart");
    expect(grownUpTurnRestarts(true, false, false)).toBe(true);
    expect(grownUpTurnRestarts(true, false, true)).toBe(false);
    expect(grownUpTurnRestarts(true, true, false)).toBe(false);
    expect(grownUpTurnRestarts(false, false, false)).toBe(false);
  });
});
