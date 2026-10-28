import { describe, expect, it } from "vite-plus/test";

import { projectsChildMayStartIn, projectsForChild, rowsForChild } from "./order";

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
});
