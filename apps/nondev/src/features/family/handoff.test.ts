import { describe, expect, it, vi } from "vite-plus/test";

import { consumeHandoff, readHandoff, withoutHandoff } from "./handoff";

const actions = () => ({ lock: vi.fn(), endSession: vi.fn(), openPicker: vi.fn() });
const at = (search: string) => ({ search, pathname: "/simple/index.html", hash: "#/" });

describe("handoff from Advanced mode", () => {
  it("reads only the two known notes", () => {
    expect(readHandoff("?handoff=switch")).toBe("switch");
    expect(readHandoff("?handoff=hand-back")).toBe("hand-back");
    expect(readHandoff("?handoff=anything")).toBeNull();
    expect(readHandoff("")).toBeNull();
  });

  it("removes the note and keeps other parts of the address", () => {
    expect(withoutHandoff("?handoff=switch")).toBe("");
    expect(withoutHandoff("?a=1&handoff=switch")).toBe("?a=1");
  });

  it("hand-back locks, ends the grown-up session, opens the picker, and strips the note", () => {
    const a = actions();
    const replace = vi.fn();
    expect(consumeHandoff(at("?handoff=hand-back"), replace, a)).toBe("hand-back");
    expect(a.lock).toHaveBeenCalledOnce();
    expect(a.endSession).toHaveBeenCalledOnce();
    expect(a.openPicker).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/simple/index.html#/");
  });

  it("switch only opens the picker", () => {
    const a = actions();
    consumeHandoff(at("?handoff=switch"), vi.fn(), a);
    expect(a.lock).not.toHaveBeenCalled();
    expect(a.endSession).not.toHaveBeenCalled();
    expect(a.openPicker).toHaveBeenCalledOnce();
  });

  it("does nothing without a note", () => {
    const a = actions();
    const replace = vi.fn();
    expect(consumeHandoff(at(""), replace, a)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(a.openPicker).not.toHaveBeenCalled();
  });
});
