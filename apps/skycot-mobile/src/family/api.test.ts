// nondev-seam: skycot-mobile-family-api-test
import { describe, expect, it } from "vite-plus/test";

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
      page: "/Users/ava/game.html",
    });
  });

  it("accepts an older engine's answer that leaves newer fields out", () => {
    expect(parseFridgePlay({ html: "<main>game</main>" })).toEqual({
      html: "<main>game</main>",
      reason: null,
      needs: { scripts: [], other: [] },
      page: null,
    });
    expect(parseFridgePlay({ html: "<main>game</main>", reason: null, page: "/g.html" })).toEqual({
      html: "<main>game</main>",
      reason: null,
      needs: { scripts: [], other: [] },
      page: "/g.html",
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
