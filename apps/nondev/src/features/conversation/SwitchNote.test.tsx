// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ child: false }));
vi.mock("../../app/useChildView", () => ({ useChildView: () => state.child }));
vi.mock("../../themes/useCrew", () => ({
  useCrew: () => ({ named: false, builder: { name: "Sam" } }),
}));

import type { AssistantSwitch } from "../../plain/switches";
import { SwitchNote } from "./SwitchNote";

afterEach(() => {
  state.child = false;
  vi.unstubAllGlobals();
});

describe("model fallback note", () => {
  it("keeps the engine note for grown-ups and hides it from the child", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const change: AssistantSwitch = {
      messageId: "skycot-switch:run-1",
      from: { instanceId: "claudeAgent", driver: "claudeAgent", model: "claude-fable-5-1" },
      to: { instanceId: "codex", driver: "codex", model: "gpt-6-astra" },
      until: null,
      crossProvider: true,
      continuationOf: "run-1",
    };
    const render = () => root.render(<SwitchNote change={change} providers={[]} />);

    await act(async () => render());
    expect(host.textContent).toContain("SKYCOT is using");

    state.child = true;
    await act(async () => render());
    expect(host.textContent).toBe("");

    await act(async () => root.unmount());
    host.remove();
  });
});
