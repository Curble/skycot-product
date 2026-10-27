// nondev-seam: web-advanced-grown-up-menu-test
import { describe, expect, it } from "vite-plus/test";

import { GROWN_UP_SESSION_KEY, isGrownUpSession, simpleViewUrl } from "./skycotHandoff";

describe("Advanced mode handoff to the simple view", () => {
  it("builds the address with the note", () => {
    expect(simpleViewUrl()).toBe("/simple/index.html");
    expect(simpleViewUrl("switch")).toBe("/simple/index.html?handoff=switch");
    expect(simpleViewUrl("hand-back")).toBe("/simple/index.html?handoff=hand-back");
  });

  it("shows the grown-up menu only while a grown-up session is marked", () => {
    expect(isGrownUpSession({ getItem: (k) => (k === GROWN_UP_SESSION_KEY ? "mum" : null) })).toBe(
      true,
    );
    expect(isGrownUpSession({ getItem: () => null })).toBe(false);
    expect(isGrownUpSession(null)).toBe(false);
    expect(
      isGrownUpSession({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});
