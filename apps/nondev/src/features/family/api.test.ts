import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The engine address is resolved from the path as given: a helper that added the Family prefix a
// second time once sent every Family, fridge and update request to /api/skycot/family/api/...
vi.mock("~/environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (path: string) => `http://engine.test${path}`,
}));
vi.mock("~/environments/primary/desktopAuth", () => ({
  readDesktopPrimaryBearerToken: async () => null,
}));

const { engineRequest, FAMILY_API_PATH } = await import("./api");

describe("engineRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the engine at exactly the path it was given", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await engineRequest("GET", `${FAMILY_API_PATH}/fridge`, undefined, () => ({}));
    await engineRequest("GET", "/api/skycot/updates", undefined, () => ({}));
    expect(urls).toEqual([
      "http://engine.test/api/skycot/family/fridge",
      "http://engine.test/api/skycot/updates",
    ]);
  });
});
