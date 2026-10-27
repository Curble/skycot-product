import { describe, expect, it } from "vite-plus/test";

import { pageOfTurn } from "./madePage";

describe("pageOfTurn", () => {
  it("prefers the page this turn made over the project's older index page", () => {
    expect(
      pageOfTurn([
        { path: "index.html", operation: "edited" },
        { path: "purple-cat.html", operation: "added" },
      ]),
    ).toBe("purple-cat.html");
  });
  it("uses an edited page when none was added, and null when no page changed", () => {
    expect(pageOfTurn([{ path: "cat/index.html", operation: "edited" }])).toBe("cat/index.html");
    expect(pageOfTurn([{ path: "style.css", operation: "added" }])).toBeNull();
    expect(pageOfTurn([{ path: "old.html", operation: "deleted" }])).toBeNull();
  });
});
