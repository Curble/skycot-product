import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const request = vi.hoisted(() => vi.fn(async () => ({ ok: true, value: { html: "<h1>Hi</h1>" } })));
vi.mock("../family/api", () => ({ request }));

import { readMagnetPage } from "./pages";

afterEach(() => request.mockClear());

describe("fridge page cache", () => {
  it("shares one thumbnail fetch for the same made page", async () => {
    const input = { threadId: "fridge-cache-test", page: "index.html", version: "content-a" };
    const [first, second] = await Promise.all([readMagnetPage(input), readMagnetPage(input)]);
    expect(first).toEqual({ kind: "page", html: "<h1>Hi</h1>" });
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledOnce();
  });

  it("fetches a rewritten page under its new content version", async () => {
    const first = { threadId: "fridge-version-test", page: "index.html", version: "old" };
    await readMagnetPage(first);
    await readMagnetPage({ ...first, version: "new" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
