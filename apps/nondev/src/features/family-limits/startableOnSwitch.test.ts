import { describe, expect, it } from "vite-plus/test";

import { composeTargetFor } from "../questions/questions";
import { startableProjects } from "./order";

interface Project {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
}
const project = (id: string, createdAt: string): Project => ({
  id,
  environmentId: "mac",
  title: id,
  workspaceRoot: `/p/${id}`,
  createdAt,
});
const family = project("family", "2026-01-01");
const ava = project("ava", "2026-02-01");
const leo = project("leo", "2026-03-01");
const idOf = (p: Project) => p.id;
const all = [leo, family, ava];

const aim = (candidates: ReadonlyArray<Project>, remembered: string | null) =>
  composeTargetFor({
    projects: candidates,
    questionsAvailable: false,
    chosen: remembered === null ? null : `mac:${remembered}`,
    preferredKey: remembered === null ? null : `mac:${remembered}`,
    last: remembered === null ? null : { environmentId: "mac", projectId: remembered },
    defaultToNewest: true,
  });

describe("startableProjects", () => {
  it("keeps the order the projects came in, not the engine list's order", () => {
    expect(
      startableProjects(all, idOf, { projects: {}, startIn: ["ava", "family", "leo"] }, "ava"),
    ).toEqual([leo, family, ava]);
  });

  it("ignores engine ids it holds no project for, and projects the engine did not list", () => {
    expect(
      startableProjects(all, idOf, { projects: {}, startIn: ["family", "ghost"] }, "ava"),
    ).toEqual([family]);
  });

  it("falls back to the owner map when the engine sends no list, and obeys an empty list", () => {
    const owners = { ava: "ava", leo: "leo" };
    expect(startableProjects(all, idOf, { projects: owners }, "ava")).toEqual([family, ava]);
    expect(startableProjects(all, idOf, { projects: owners, startIn: [] }, "ava")).toEqual([]);
  });

  it("offers nothing when no child is chosen", () => {
    expect(startableProjects(all, idOf, { projects: {}, startIn: ["family"] }, null)).toEqual([]);
  });
});

describe("switching from one child to another", () => {
  it("drops the remembered sibling project and aims at the new child's newest", () => {
    // Leo was using his project; the grown-up hands the Mac to Ava. Leo's project is
    // remembered by the box but the engine does not list it for Ava.
    const forAva = startableProjects(
      all,
      idOf,
      { projects: {}, startIn: ["family", "ava"] },
      "ava",
    );
    expect(aim(forAva, "leo")).toEqual({ kind: "project", project: ava });
  });

  it("keeps a remembered project that the new child may start in", () => {
    const forAva = startableProjects(
      all,
      idOf,
      { projects: {}, startIn: ["family", "ava"] },
      "ava",
    );
    expect(aim(forAva, "family")).toEqual({ kind: "project", project: family });
  });

  it("aims nowhere rather than at a sibling when the child may start in nothing", () => {
    const none = startableProjects(all, idOf, { projects: {}, startIn: [] }, "ava");
    expect(aim(none, "leo")).toBeNull();
  });
});
