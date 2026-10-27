// nondev-seam: skycot-fridge-card-mobile-test
// nondev-seam: skycot-mobile-family-api-test
import { describe, expect, it, vi } from "vite-plus/test";

import { familyApi, parseFridgePlay, parsePageInternetAsk } from "./api";
import type { MacTransport } from "../transport/MacTransport";

describe("the playable fridge response", () => {
  it("reads the runnable copy, refusal reason and Mac path", () => {
    expect(
      parseFridgePlay({
        html: "<main>game</main>",
        reason: null,
        needs: { scripts: [], other: [] },
        page: "/Users/ava/game.html",
      }),
    ).toEqual({
      html: "<main>game</main>",
      reason: null,
      needs: { scripts: [], other: [] },
      diag: { packedBytes: 0, embeddedFiles: 0, modulesBundled: false, missingFiles: [] },
      page: "/Users/ava/game.html",
    });
    expect(
      parseFridgePlay({
        html: null,
        reason: "too-big",
        needs: { scripts: ["example.com"], other: [] },
        page: "/Users/ava/game.html",
      }),
    ).toEqual({
      html: null,
      reason: "too-big",
      needs: { scripts: ["example.com"], other: [] },
      diag: { packedBytes: 0, embeddedFiles: 0, modulesBundled: false, missingFiles: [] },
      page: "/Users/ava/game.html",
    });
  });

  it("accepts an older engine's answer that leaves newer fields out", () => {
    expect(parseFridgePlay({ html: "<main>game</main>" })).toEqual({
      html: "<main>game</main>",
      reason: null,
      needs: { scripts: [], other: [] },
      diag: { packedBytes: 0, embeddedFiles: 0, modulesBundled: false, missingFiles: [] },
      page: null,
    });
    expect(parseFridgePlay({ html: "<main>game</main>", reason: null, page: "/g.html" })).toEqual({
      html: "<main>game</main>",
      reason: null,
      needs: { scripts: [], other: [] },
      diag: { packedBytes: 0, embeddedFiles: 0, modulesBundled: false, missingFiles: [] },
      page: "/g.html",
    });
  });

  it("reads pack diagnostics while older engines default them to empty", () => {
    expect(
      parseFridgePlay({
        html: "game",
        diag: {
          packedBytes: 1234,
          embeddedFiles: 4,
          modulesBundled: true,
          missingFiles: ["img/cat.png"],
        },
      })?.diag,
    ).toEqual({
      packedBytes: 1234,
      embeddedFiles: 4,
      modulesBundled: true,
      missingFiles: ["img/cat.png"],
    });
  });

  it("rejects malformed response fields", () => {
    expect(parseFridgePlay({ html: 3, reason: null, page: "/game.html" })).toBeNull();
    expect(parseFridgePlay({ html: null, reason: "unavailable", page: null })).toBeNull();
  });

  it("recognizes an older Mac that does not have the playable route", async () => {
    const transport = {
      request: async () => ({ status: 404, json: { error: "not-found" } }),
    } as MacTransport;
    await expect(familyApi.fridgePlay(transport, "thread", "game.html")).resolves.toMatchObject({
      ok: false,
      routeUnavailable: true,
    });
  });
});

describe("page internet ask response", () => {
  it("keeps the namespaced request id used by the ordinary approval flow", () => {
    expect(parsePageInternetAsk({ ask: { id: "page-internet:ask-1", expiresAt: 123 } })).toEqual({
      id: "page-internet:ask-1",
      expiresAt: 123,
    });
  });

  it("rejects a malformed or unnamespaced id", () => {
    expect(parsePageInternetAsk({ ask: { id: "request-1", expiresAt: 123 } })).toBeNull();
    expect(parsePageInternetAsk({ ask: null })).toBeNull();
  });
});

describe("fridge picture cards on the phone", () => {
  it("keeps the cardHash the Mac sends and leaves it out for an older Mac", async () => {
    const item = { threadId: "t", page: "index.html", cwd: "/p", madeAt: 1, pinnedAt: null };
    const transport = {
      request: async () => ({
        status: 200,
        json: {
          items: [
            { ...item, cardHash: "abc" },
            { ...item, threadId: "old" },
          ],
        },
      }),
    } as MacTransport;
    const answer = await familyApi.fridge(transport);
    expect(answer.ok && answer.value.map((entry) => entry.cardHash)).toEqual(["abc", undefined]);
  });

  it("fetches a card as text and refuses anything that is not an SVG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>boom()</script></svg>';
    const ask = vi.fn(async () => ({ status: 200, json: null, text: svg }));
    await expect(
      familyApi.fridgeCard({ request: ask } as unknown as MacTransport, "h1"),
    ).resolves.toBe(svg);
    expect(ask).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/skycot/family/fridge/card",
      query: { hash: "h1" },
    });
    const html = { request: async () => ({ status: 200, json: null, text: "<html></html>" }) };
    await expect(familyApi.fridgeCard(html as unknown as MacTransport, "h2")).resolves.toBeNull();
    const missing = { request: async () => ({ status: 404, json: { error: "x" } }) };
    await expect(
      familyApi.fridgeCard(missing as unknown as MacTransport, "h3"),
    ).resolves.toBeNull();
  });

  it("fetches a page's real picture as an image address, or null", async () => {
    const ask = vi.fn(async () => ({ status: 200, json: { pngBase64: "iVBORw0KGgo=" } }));
    await expect(
      familyApi.fridgePicture({ request: ask } as unknown as MacTransport, "h1"),
    ).resolves.toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(ask).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/skycot/family/fridge/picture-data",
      query: { hash: "h1" },
    });
    for (const answer of [
      { status: 404, json: { error: "invalid-request" } },
      { status: 200, json: { pngBase64: 'x"onload=' } },
      { status: 200, json: null },
    ]) {
      await expect(
        familyApi.fridgePicture({ request: async () => answer } as unknown as MacTransport, "h"),
      ).resolves.toBeNull();
    }
    const down = {
      request: async () => {
        throw new Error("offline");
      },
    };
    await expect(familyApi.fridgePicture(down as unknown as MacTransport, "h")).resolves.toBeNull();
  });
});
