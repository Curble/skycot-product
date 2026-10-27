import { describe, expect, it } from "vite-plus/test";

import { projectCreationProblem } from "./projectProblem";

describe("project creation problems", () => {
  it("explains common folder failures without showing a machine path", () => {
    expect(projectCreationProblem("EEXIST: file already exists, mkdir /Users/leo/Game")).toBe(
      "A folder with that name already exists. Try another name.",
    );
    expect(projectCreationProblem("EACCES: permission denied, mkdir /Users/leo/Game")).toContain(
      "Ask a grown-up",
    );
    expect(projectCreationProblem("unrecognized folder failure at /tmp/test")).not.toContain(
      "/tmp/test",
    );
  });
});
