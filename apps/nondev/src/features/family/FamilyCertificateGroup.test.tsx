// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: false,
  requireParentCode: vi.fn(async () => state.allowed),
}));

vi.mock("./FamilyProvider", () => ({ useFamily: () => state }));

import { FamilyCertificateGroup } from "./FamilyCertificateGroup";

afterEach(() => {
  window.localStorage.clear();
  state.allowed = false;
  state.requireParentCode.mockClear();
});

describe("the grown-up certificate control", () => {
  it("checks the parent code to turn certificates off, then lets a parent turn them back on", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<FamilyCertificateGroup />));

    const control = () => host.querySelector<HTMLButtonElement>("[role='switch']")!;
    expect(control().getAttribute("aria-checked")).toBe("true");

    await act(async () => control().click());
    expect(state.requireParentCode).toHaveBeenCalledWith("voiceSettings");
    expect(control().getAttribute("aria-checked")).toBe("true");

    state.allowed = true;
    await act(async () => control().click());
    expect(control().getAttribute("aria-checked")).toBe("false");
    await act(async () => control().click());
    expect(control().getAttribute("aria-checked")).toBe("true");

    await act(async () => root.unmount());
    host.remove();
  });
});
