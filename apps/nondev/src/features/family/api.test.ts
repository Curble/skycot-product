import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (pathname: string) => `http://127.0.0.1:47391${pathname}`,
}));
vi.mock("~/environments/primary/desktopAuth", () => ({
  readDesktopPrimaryBearerToken: async () => "token",
}));

import { callEngine, engineRequest, request } from "./api";

// Regression: a merge left `engineRequest` prefixing the Family path a second time, so every
// Family and update call went to `/api/skycot/family/api/skycot/...` and failed. The first-run
// welcome steps then never opened, because they wait for the engine's Family answer.
describe("engine requests", () => {
  it("ask the engine for exactly the route they name", async () => {
    const asked: string[] = [];
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      asked.push(String(input));
      return new Response("{}", { status: 200 });
    });
    await request("GET", "/status", undefined, () => ({}));
    await engineRequest("GET", "/api/skycot/updates", undefined, () => ({}));
    expect(asked).toEqual([
      "http://127.0.0.1:47391/api/skycot/family/status",
      "http://127.0.0.1:47391/api/skycot/updates",
    ]);
  });

  it("keeps desktop bearer auth and same-origin cookies for Family session routes", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://127.0.0.1:47391" },
      desktopBridge: {},
    });
    let init: RequestInit | undefined;
    using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
      init = options;
      return new Response("{}", { status: 200 });
    });
    try {
      await callEngine("POST", "/api/skycot/family/renew", {});
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
