import { describe, expect, it } from "vite-plus/test";

import { explainOnFor, parseExplainChoices, withExplainChoice } from "./explainMode";

describe("explain mode per conversation", () => {
  it("follows the Family profile until a conversation chooses", () => {
    expect(explainOnFor({}, "t1", true)).toBe(true);
    expect(explainOnFor({}, "t1", false)).toBe(false);
    expect(explainOnFor({ t1: false }, "t1", true)).toBe(false);
    expect(explainOnFor({ t1: true }, "t1", false)).toBe(true);
  });

  it("stores only a choice that differs from the default", () => {
    expect(withExplainChoice({}, "t1", true, false)).toEqual({ t1: true });
    expect(withExplainChoice({ t1: true }, "t1", false, false)).toEqual({});
    expect(withExplainChoice({ t2: true }, "t1", true, true)).toEqual({ t2: true });
  });

  it("reads nothing from unreadable storage", () => {
    expect(parseExplainChoices(null)).toEqual({});
    expect(parseExplainChoices("not json")).toEqual({});
    expect(parseExplainChoices("[true]")).toEqual({});
    expect(parseExplainChoices('{"t1":true,"t2":"yes"}')).toEqual({ t1: true });
  });
});
