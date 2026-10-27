// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../../state/conversations", () => ({ conversationRowsAtom: {} }));
vi.mock("../../state/oldConversations", () => ({ oldConversationRowsAtom: {} }));
vi.mock("../family/FamilyProvider", () => ({
  useFamily: () => ({ enabled: true, profile: { childName: "Ava" } }),
}));
vi.mock("./store", () => ({ useBadges: () => ({ book: null, status: "loading" }) }));

import { CertificateScreen } from "./Certificate";
import { writeFamilyCertificatesOn } from "../settings/localPrefs";

afterEach(() => {
  writeFamilyCertificatesOn(true);
});

describe("grown-up certificate choice", () => {
  it("hides printing when certificates are off, including a previously opened certificate link", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    writeFamilyCertificatesOn(false);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<CertificateScreen kind="first" />));

    expect(host.textContent).toContain("Certificates are turned off");
    expect(host.textContent).toContain("Settings → Family");
    expect(host.textContent).not.toContain("Print or save as PDF");

    await act(async () => root.unmount());
    host.remove();
  });
});
