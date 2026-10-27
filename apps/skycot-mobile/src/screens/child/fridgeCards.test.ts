// nondev-seam: skycot-fridge-card-draw-test
import { describe, expect, it, vi } from "vite-plus/test";

import { createCardCache, safeCardSvg } from "./fridgeCards";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

describe("which card text is safe to draw", () => {
  it("keeps plain pictures and refuses anything with a script", () => {
    expect(safeCardSvg(SVG)).toBe(SVG);
    expect(safeCardSvg(null)).toBeNull();
    expect(safeCardSvg("<svg><script>alert(1)</script></svg>")).toBeNull();
    expect(safeCardSvg("<svg><SCRIPT src='x'/></svg>")).toBeNull();
  });
});

describe("the card memory", () => {
  it("fetches once per hash, and again for a changed hash", async () => {
    const fetchCard = vi.fn(async (hash: string) => `${SVG}<!--${hash}-->`);
    const cache = createCardCache();
    await Promise.all([cache.load("a", fetchCard), cache.load("a", fetchCard)]);
    await cache.load("a", fetchCard);
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(cache.peek("a")).toContain("a");
    await cache.load("b", fetchCard);
    expect(fetchCard).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure or a script, so the next look tries again", async () => {
    const answers: (string | null)[] = [null, "<svg><script/></svg>", SVG];
    const fetchCard = vi.fn(async () => answers.shift() ?? null);
    const cache = createCardCache();
    expect(await cache.load("h", fetchCard)).toBeNull();
    expect(await cache.load("h", fetchCard)).toBeNull();
    expect(cache.peek("h")).toBeNull();
    expect(await cache.load("h", fetchCard)).toBe(SVG);
    expect(fetchCard).toHaveBeenCalledTimes(3);
  });

  it("treats a thrown fetch as no card", async () => {
    const cache = createCardCache();
    expect(
      await cache.load("x", async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });

  it("holds only the newest cards", async () => {
    const cache = createCardCache(2);
    const fetchCard = async () => SVG;
    await cache.load("1", fetchCard);
    await cache.load("2", fetchCard);
    await cache.load("3", fetchCard);
    expect(cache.peek("1")).toBeNull();
    expect(cache.peek("2")).toBe(SVG);
    expect(cache.peek("3")).toBe(SVG);
  });
});
