// nondev-seam: skycot-mobile-family-api-test
import { describe, expect, it } from "vite-plus/test";

import { parseFridgePlay, parsePageInternetAsk } from "./api";

describe("the playable fridge response", () => {
  it("reads the runnable copy, refusal reason and Mac path", () => {
    expect(
      parseFridgePlay({ html: "<main>game</main>", reason: null, page: "/Users/ava/game.html" }),
    ).toEqual({
      html: "<main>game</main>",
      reason: null,
      page: "/Users/ava/game.html",
    });
    expect(
      parseFridgePlay({ html: null, reason: "too-big", page: "/Users/ava/game.html" }),
    ).toEqual({
      html: null,
      reason: "too-big",
      page: "/Users/ava/game.html",
    });
  });

  it("rejects malformed response fields", () => {
    expect(parseFridgePlay({ html: 3, reason: null, page: "/game.html" })).toBeNull();
    expect(parseFridgePlay({ html: null, reason: "unavailable", page: null })).toBeNull();
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
