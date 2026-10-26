// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  child: false,
  attempt: null as ((code: string) => Promise<unknown>) | null,
  allow: vi.fn(async (..._args: unknown[]) => ({ ok: true, value: null })),
}));

vi.mock("../../app/useChildView", () => ({ useChildView: () => state.child }));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({ profile: { grownUps: [{ name: "Mum" }] } }),
}));
vi.mock("../conversation/useGrownUpAnswers", () => ({ useGrownUpAnswers: () => new Map() }));
vi.mock("../family/store", () => ({
  allowPageInternet: (...args: Parameters<typeof state.allow>) => state.allow(...args),
  askPageInternet: vi.fn(),
  refreshFamily: vi.fn(async () => {}),
}));
vi.mock("../family/ParentCodeEntry", () => ({
  ParentCodeEntry: () => null,
  useParentCodeEntry: (
    attempt: (code: string) => Promise<{ ok: boolean }>,
    success: () => void,
  ) => {
    state.attempt = attempt;
    return {
      canSubmit: true,
      busy: false,
      submit: async () => {
        const result = await attempt("1234");
        if (result.ok) success();
      },
    };
  },
}));

import { PageInternetAsk } from "./PageInternetAsk";

afterEach(() => {
  state.child = false;
  state.attempt = null;
  state.allow.mockClear();
});

describe("page internet project approval", () => {
  it("lets the grown-up choose project scope and sends that scope to the engine", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAllowed = vi.fn();
    await act(async () =>
      root.render(
        <PageInternetAsk
          threadId="thread-1"
          page="/games/lobster.html"
          sites={["fonts.gstatic.com"]}
          onAllowed={onAllowed}
        />,
      ),
    );
    expect(host.textContent).toContain("Google Fonts' files");
    const projectButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Allow for this project",
    );
    expect(projectButton).toBeDefined();
    await act(async () => projectButton!.click());
    const allowButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Allow for this project",
    );
    await act(async () => allowButton!.click());
    expect(state.allow).toHaveBeenCalledWith("/games/lobster.html", ["fonts.gstatic.com"], "1234", {
      threadId: "thread-1",
      scope: "project",
    });
    expect(onAllowed).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });
});
