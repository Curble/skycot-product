// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  profile: {
    children: [{ id: "child-ava", name: "Ava" }],
    projectApprovalGrants: [
      {
        id: "grant-fonts",
        childId: "child-ava",
        projectPath: "/Users/ava/Projects/lobster-page",
        covers: ["internetFetch"],
        expiresAt: 1_800_000_000_000,
      },
    ],
    rememberedStarts: [] as Array<{
      id: string;
      projectRealPath: string;
      approvedBy: string;
      how: string;
      createdAt: number;
    }>,
  },
}));

vi.mock("./FamilyProvider", () => ({ useFamily: () => ({ profile: state.profile }) }));
vi.mock("./store", () => ({
  stopProjectApproval: vi.fn(async () => ({ ok: true })),
  stopRememberedStart: vi.fn(async () => ({ ok: true })),
}));

import { ProjectApprovalsGroup } from "./ProjectApprovalsGroup";
import { stopRememberedStart } from "./store";

afterEach(() => {
  state.profile.projectApprovalGrants = [];
  state.profile.rememberedStarts = [];
});

describe("project permissions in Family settings", () => {
  it("renders the engine's project grant as a named permission with Stop", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    state.profile.projectApprovalGrants = [
      {
        id: "grant-fonts",
        childId: "child-ava",
        projectPath: "/Users/ava/Projects/lobster-page",
        covers: ["internetFetch"],
        expiresAt: 1_800_000_000_000,
      },
    ];
    await act(async () => root.render(<ProjectApprovalsGroup />));
    expect(host.textContent).toContain("What Ava may do in lobster-page");
    expect(host.textContent).toContain("fetch plain pages and data");
    expect(host.querySelector("button")?.textContent).toBe("Stop");
    await act(async () => root.unmount());
    host.remove();
  });

  it("lists a remembered website start and lets a grown-up stop it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    state.profile.rememberedStarts = [
      {
        id: "start-1",
        projectRealPath: "/Users/ava/Projects/lobster-page",
        approvedBy: "parent-code",
        how: "parent-code",
        createdAt: 1,
      },
    ];
    await act(async () => root.render(<ProjectApprovalsGroup />));
    expect(host.textContent).toContain("Open the website in lobster-page");
    expect(host.textContent).toContain("A different command will ask again");
    await act(async () => host.querySelector("button")?.click());
    expect(stopRememberedStart).toHaveBeenCalledWith("start-1");
    await act(async () => root.unmount());
    host.remove();
  });
});
