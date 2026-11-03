// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({ profile: { me: { kind: "child" } } }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/threads", () => ({ threadEnvironment: { cancelQueuedRun: {} } }));
vi.mock("../../themes/useCrew", () => ({ useCrew: () => ({ builder: { name: "Sam" } }) }));
vi.mock("../../ui/Toast", () => ({ showToast: vi.fn() }));

import { TakeBackActions } from "./MessageActions";

describe("Take back button", () => {
  it("is the app's small secondary button, not a bare text link", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <TakeBackActions
          environmentId={"e" as never}
          threadId={"t" as never}
          runId={"r" as never}
          text="hello"
          pictures={0}
        >
          {({ actions }) => <div>{actions}</div>}
        </TakeBackActions>,
      ),
    );
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Take back");
    expect(button.classList.contains("fm-btn")).toBe(true);
    expect(button.classList.contains("fm-btn--sm")).toBe(true);
    expect(button.classList.contains("fm-btn--primary")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Take back this lined-up message");
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
