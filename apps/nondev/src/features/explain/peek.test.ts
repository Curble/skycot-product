import { describe, expect, it } from "vite-plus/test";

import { peekAtCode } from "./peek";

const FOOTER_DIFF = [
  "diff --git a/index.html b/index.html",
  "index 1111111..2222222 100644",
  "--- a/index.html",
  "+++ b/index.html",
  "@@ -40,7 +40,7 @@",
  "   <main>",
  "     <h1>Foreman Demo Cafe</h1>",
  "   </main>",
  "   <footer>",
  "-    <p>© Foreman Demo Cafe</p>",
  "+    <p>Made with SKYCOT</p>",
  "   </footer>",
  " </body>",
].join("\n");

describe("peekAtCode", () => {
  it("shows the change with one line either side", () => {
    expect(peekAtCode(FOOTER_DIFF)).toEqual({
      files: [
        {
          path: "index.html",
          lines: [
            { key: 0, kind: "same", text: "  <footer>" },
            { key: 1, kind: "removed", text: "    <p>© Foreman Demo Cafe</p>" },
            { key: 2, kind: "added", text: "    <p>Made with SKYCOT</p>" },
            { key: 3, kind: "same", text: "  </footer>" },
          ],
        },
      ],
      moreLines: 0,
      moreFiles: 0,
    });
  });

  it("names a new file by its path and keeps every line under the cap", () => {
    const added = Array.from({ length: 30 }, (_, index) => `+line ${index + 1}`);
    const diff = [
      "diff --git a/game.js b/game.js",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/game.js",
      "@@ -0,0 +1,30 @@",
      ...added,
    ].join("\n");
    const peek = peekAtCode(diff);
    expect(peek.files[0]!.path).toBe("game.js");
    expect(peek.files[0]!.lines).toHaveLength(20);
    expect(peek.moreLines).toBe(10);
  });

  it("leaves out lock files and pictures, and counts files that did not fit", () => {
    const lock = [
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1 +1 @@",
      '-"a": 1',
      '+"a": 2',
    ].join("\n");
    const many = Array.from({ length: 21 }, (_, i) => `+x${i}`);
    const big = ["diff --git a/a.js b/a.js", "+++ b/a.js", "@@ -0,0 +1,21 @@", ...many].join("\n");
    const peek = peekAtCode([lock, big, FOOTER_DIFF].join("\n"));
    expect(peek.files.map((file) => file.path)).toEqual(["a.js"]);
    expect(peek.moreFiles).toBe(1);
    expect(peek.moreLines).toBe(1 + 2);
  });

  it("marks a gap between two changes in one file", () => {
    const diff = [
      "diff --git a/style.css b/style.css",
      "+++ b/style.css",
      "@@ -1,3 +1,3 @@",
      " a {",
      "-  color: red;",
      "+  color: blue;",
      " }",
      "@@ -50,3 +50,3 @@",
      " b {",
      "-  size: 1;",
      "+  size: 2;",
      " }",
    ].join("\n");
    const lines = peekAtCode(diff).files[0]!.lines.map((line) => line.text);
    expect(lines).toEqual([
      "a {",
      "  color: red;",
      "  color: blue;",
      "}",
      "…",
      "b {",
      "  size: 1;",
      "  size: 2;",
      "}",
    ]);
  });

  it("is empty for an empty diff", () => {
    expect(peekAtCode("")).toEqual({ files: [], moreLines: 0, moreFiles: 0 });
  });
});
