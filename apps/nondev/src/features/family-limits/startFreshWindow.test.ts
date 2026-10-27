import { describe, expect, it } from "vite-plus/test";

import { startFreshWindow } from "./store";

describe("startFreshWindow", () => {
  it("sets Home before marking and reloading, so the reload never returns to a grown-up page", () => {
    const calls: string[] = [];
    const win = {
      location: {
        _hash: "#/settings/family",
        get hash() {
          return this._hash;
        },
        set hash(value: string) {
          this._hash = value;
          calls.push(`hash:${value}`);
        },
        reload: () => calls.push(`reload@${win.location._hash}`),
      },
    };
    startFreshWindow(win, () => calls.push("mark"));
    expect(calls).toEqual(["hash:#/", "mark", "reload@#/"]);
  });
});
