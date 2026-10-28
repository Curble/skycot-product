// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  requireParentCode: vi.fn(async (_action: string) => false),
  allowRestart: vi.fn(async (_version: string) => ({ ok: true })),
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../../state/conversations", () => ({ conversationRowsAtom: {} }));
vi.mock("../../themes/useCrew", () => ({ useCrew: () => ({ builder: { name: "Pip" } }) }));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({ enabled: true, requireParentCode: mocks.requireParentCode }),
}));
vi.mock("../family/store", () => ({ refreshFamily: vi.fn(async () => undefined) }));
vi.mock("./api", () => ({ updatesApi: { allowRestart: mocks.allowRestart } }));
vi.mock("./store", () => ({
  installDownloadedUpdate: vi.fn(async () => true),
  useDesktopUpdateState: () => ({
    enabled: true,
    status: "downloaded",
    downloadedVersion: "9.9.9",
    errorContext: null,
    message: null,
    releaseNotes: [],
    checkedAt: null,
  }),
}));

import { COULD_NOT_CONFIRM, RestartSheet } from "./RestartSheet";

describe("Restart to update", () => {
  it("says what is needed when grown-up mode and the code sheet both come up empty", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<RestartSheet open onClose={() => undefined} />));
    const button = [...document.querySelectorAll("button")].find((b) =>
      /Restart now/.test(b.textContent ?? ""),
    );
    await act(async () => button?.click());
    expect(mocks.requireParentCode).toHaveBeenCalledWith("restartToUpdate");
    expect(mocks.allowRestart).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(COULD_NOT_CONFIRM);
    expect(COULD_NOT_CONFIRM).toContain("Enter the parent code to restart.");
    await act(async () => root.unmount());
    host.remove();
  });
});
