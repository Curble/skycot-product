import { describe, expect, it } from "vite-plus/test";

import { grownUpControlsShown } from "../compose/depthChoice";
import { fileNameOf, withLineNotes, type LineNote } from "./notes";

const note = (id: string, over: Partial<LineNote> = {}): LineNote => ({
  id,
  path: "site/index.html",
  line: 12,
  removed: false,
  note: "Make this bigger",
  ...over,
});

describe("who can add notes on the code", () => {
  it("is the grown-up rule: not a child, not with Family on", () => {
    expect(grownUpControlsShown({ childView: true, familyOn: false })).toBe(false);
    expect(grownUpControlsShown({ childView: false, familyOn: true })).toBe(false);
    expect(grownUpControlsShown({ childView: false, familyOn: false })).toBe(true);
  });
});

describe("withLineNotes", () => {
  it("leaves a message alone when there are no notes", () => {
    expect(withLineNotes("Hello", [])).toBe("Hello");
  });

  it("puts a plain block of notes ahead of what was typed", () => {
    const text = withLineNotes("Then add a footer", [
      note("a"),
      note("b", { path: "css/main.css", line: 3, note: "A softer\ncolour" }),
    ]);
    expect(text).toBe(
      [
        "Notes on the code:",
        "- site/index.html line 12: Make this bigger",
        "- css/main.css line 3: A softer colour",
        "",
        "Then add a footer",
      ].join("\n"),
    );
  });

  it("is the whole message when nothing else was typed", () => {
    expect(withLineNotes("", [note("a")])).toBe(
      "Notes on the code:\n- site/index.html line 12: Make this bigger",
    );
  });

  it("says when the line was one the change took out", () => {
    expect(withLineNotes("", [note("a", { removed: true })])).toContain(
      "line 12 (a line that was taken out): Make this bigger",
    );
  });
});

describe("fileNameOf", () => {
  it("is the last part of the path", () => {
    expect(fileNameOf("a/b/index.html")).toBe("index.html");
    expect(fileNameOf("index.html")).toBe("index.html");
  });
});
