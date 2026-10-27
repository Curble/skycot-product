// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  profile: {
    children: [{ id: "kid", name: "Ava" }],
    projectArchives: [] as Array<{
      projectId: string;
      childId: string | null;
      archivedAt: number;
      by: "child" | "grown-up";
    }>,
    kidsVisibleProjects: [] as Array<string>,
    developerProjects: [] as Array<string>,
  },
  projects: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.projects }));
vi.mock("../../state/projects", () => ({ environmentProjects: { projectsAtom: {} } }));
vi.mock("./FamilyProvider", () => ({ useFamily: () => ({ profile: state.profile }) }));
vi.mock("./store", () => ({
  bringBackProject: vi.fn(async () => ({ ok: true })),
  setProjectForKids: vi.fn(async () => ({ ok: true })),
}));

import { ForTheKidsGroup, PutAwayGroup } from "./ProjectVisibilityGroups";
import { bringBackProject, setProjectForKids } from "./store";

afterEach(() => {
  state.profile.projectArchives = [];
  state.profile.kidsVisibleProjects = [];
  state.profile.developerProjects = [];
  state.projects = [];
});

const mount = async (node: React.ReactNode) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
};

describe("project visibility in Family settings", () => {
  it("lists a put-away project with who did it, and brings it back", async () => {
    state.projects = [{ id: "p1", title: "Dinos" }];
    state.profile.projectArchives = [
      { projectId: "p1", childId: "kid", archivedAt: 1, by: "child" },
    ];
    const { host, done } = await mount(<PutAwayGroup />);
    expect(host.textContent).toContain("Put away");
    expect(host.textContent).toContain("Dinos");
    expect(host.textContent).toContain("Put away by Ava");
    await act(async () => host.querySelector("button")?.click());
    expect(bringBackProject).toHaveBeenCalledWith("p1");
    await done();
  });

  it("shows hidden code projects with a Show to the kids switch", async () => {
    state.projects = [
      { id: "code", title: "skycot-next" },
      { id: "games", title: "Games" },
    ];
    state.profile.developerProjects = ["code"];
    const { host, done } = await mount(<ForTheKidsGroup />);
    expect(host.textContent).toContain("skycot-next");
    expect(host.textContent).not.toContain("Games");
    expect(host.textContent).toContain("Hidden from the kids");
    await act(async () => host.querySelector<HTMLButtonElement>('button[role="switch"]')?.click());
    expect(setProjectForKids).toHaveBeenCalledWith("code", true);
    await done();
  });

  it("shows nothing when there is nothing to decide", async () => {
    const put = await mount(<PutAwayGroup />);
    expect(put.host.textContent).toBe("");
    await put.done();
    const kids = await mount(<ForTheKidsGroup />);
    expect(kids.host.textContent).toBe("");
    await kids.done();
  });
});
