import { describe, expect, it } from "vite-plus/test";

import {
  projectsChildMayStartIn,
  projectsForChild,
  rowsForChild,
  startableProjects,
} from "./order";

describe("child work visibility", () => {
  it("shows only the selected child's conversations", () => {
    const rows = [{ id: "leo" }, { id: "ava" }, { id: "unknown" }];
    expect(rowsForChild(rows, (row) => row.id, { leo: "leo", ava: "ava" }, "leo")).toEqual([
      { id: "leo" },
    ]);
  });

  it("keeps only the child's projects and a sibling project with the child's own work", () => {
    const projects = [{ id: "developer" }, { id: "leo" }, { id: "ava" }];
    expect(
      projectsForChild(
        projects,
        (project) => project.id,
        { leo: "leo", ava: "ava" },
        "leo",
        new Set(),
      ),
    ).toEqual([{ id: "leo" }]);
    expect(
      projectsForChild(
        projects,
        (project) => project.id,
        { leo: "leo", ava: "ava" },
        "leo",
        new Set(["ava"]),
      ),
    ).toEqual([{ id: "leo" }, { id: "ava" }]);
  });

  it("starts new work only in the child's own or an unowned project, never a sibling's", () => {
    const projects = [{ id: "family" }, { id: "leo" }, { id: "ava" }];
    const owners = { leo: "leo", ava: "ava" };
    expect(projectsChildMayStartIn(projects, (project) => project.id, owners, "leo")).toEqual([
      { id: "family" },
      { id: "leo" },
    ]);
    expect(projectsChildMayStartIn(projects, (project) => project.id, owners, null)).toEqual([]);
  });

  it("obeys the engine's startIn list, and falls back to the owner map without it", () => {
    const projects = [{ id: "family" }, { id: "leo" }, { id: "ava" }];
    const idOf = (project: { id: string }) => project.id;
    // The child's owner map is own-only, so the sibling's project looks unowned here.
    const today = { projects: { leo: "leo" } };
    expect(
      startableProjects(projects, idOf, { ...today, startIn: ["family", "leo"] }, "leo"),
    ).toEqual([{ id: "family" }, { id: "leo" }]);
    expect(startableProjects(projects, idOf, { ...today, startIn: [] }, "leo")).toEqual([]);
    expect(startableProjects(projects, idOf, today, "leo")).toEqual(projects);
    expect(startableProjects(projects, idOf, { ...today, startIn: ["leo"] }, null)).toEqual([]);
  });
});
