import { describe, expect, it } from "vite-plus/test";

import { parseDeepLink } from "./deepLinkParse";

describe("SKYCOT's links", () => {
  it("opens a section, a conversation and the Macs screen", () => {
    expect(parseDeepLink("skycot://section/fridge", false)).toEqual({
      kind: "section",
      id: "fridge",
    });
    expect(parseDeepLink("skycot://conversation/mac%201/thread-2", false)).toEqual({
      kind: "conversation",
      macId: "mac 1",
      threadId: "thread-2",
    });
    expect(parseDeepLink("skycot://open/macs", false)).toEqual({ kind: "open", route: "Macs" });
  });

  it("only fills a code in; linking by itself and demos are for development builds", () => {
    expect(parseDeepLink("skycot://link?code=7KQ3M9XD2HPA&address=mac.local&go=1", false)).toEqual({
      kind: "link",
      code: "7KQ3M9XD2HPA",
      address: "mac.local",
      go: false,
    });
    expect(parseDeepLink("skycot://demo/plan", false)).toBeNull();
    expect(parseDeepLink("skycot-dev://demo/plan", true)).toEqual({ kind: "demo", name: "plan" });
  });

  it("ignores anything else, and never throws", () => {
    expect(parseDeepLink("https://skycot.com", true)).toBeNull();
    expect(parseDeepLink("skycot://link?code=%E0%A4%A", true)).toBeNull();
    expect(parseDeepLink("skycot://", true)).toBeNull();
  });
});
