import { describe, expect, it } from "vite-plus/test";

import { projectPlaceholder, withoutTrailingEllipsis } from "./placeholderText";

describe("projectPlaceholder", () => {
  it("keeps a plain title and adds one ellipsis", () => {
    expect(projectPlaceholder("Space Game")).toBe("Say what you'd like done in Space Game…");
  });
  it("does not double an ellipsis from a truncated title", () => {
    expect(projectPlaceholder("Four-panel Comic Strip About A…")).toBe(
      "Say what you'd like done in Four-panel Comic Strip About A…",
    );
    expect(projectPlaceholder("Four-panel Comic Strip About A...")).toBe(
      "Say what you'd like done in Four-panel Comic Strip About A…",
    );
  });
  it("strips trailing spaces and periods", () => {
    expect(withoutTrailingEllipsis("My cat . …")).toBe("My cat");
  });
});
