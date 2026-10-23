import { describe, expect, it } from "vite-plus/test";

import {
  changedAgo,
  codeNote,
  crumbsOf,
  entryDetails,
  formatSize,
  hiddenHere,
  inlinePageAssets,
  pageAssetKey,
  pageAssetRefs,
  parentOf,
  parseFileRead,
  parseListing,
  resolvePageRef,
  visibleEntries,
  type FilesEntry,
  markdownForQuickLook,
} from "./model";

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime();
const entry = (over: Partial<FilesEntry> & Pick<FilesEntry, "name">): FilesEntry => ({
  path: over.name,
  kind: "file",
  size: 1200,
  modifiedAt: NOW - 5 * 60_000,
  noise: false,
  ...over,
});

describe("rows", () => {
  it("say the kind, the size and when it changed, in plain words", () => {
    expect(entryDetails(entry({ name: "cat.png", size: 24_300 }), NOW)).toBe(
      "Picture · 24 KB · changed 5 minutes ago",
    );
    expect(entryDetails(entry({ name: "pictures", kind: "folder", size: null }), NOW)).toBe(
      "Folder · changed 5 minutes ago",
    );
    expect(entryDetails(entry({ name: "index.html", modifiedAt: null }), NOW)).toBe(
      "Page · 1.2 KB",
    );
  });

  it("size files the way Finder does", () => {
    expect(formatSize(0)).toBe("Zero bytes");
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(999)).toBe("999 bytes");
    expect(formatSize(1_000)).toBe("1 KB");
    expect(formatSize(24_300)).toBe("24 KB");
    expect(formatSize(2_450_000)).toBe("2.5 MB");
    expect(formatSize(12_000_000)).toBe("12 MB");
  });

  it("count time like a person", () => {
    expect(changedAgo(NOW - 10_000, NOW)).toBe("changed just now");
    expect(changedAgo(NOW - 60_000, NOW)).toBe("changed 1 minute ago");
    expect(changedAgo(NOW - 3 * 3_600_000, NOW)).toBe("changed 3 hours ago");
    expect(changedAgo(new Date(2026, 9, 22, 20, 0).getTime(), NOW)).toBe("changed yesterday");
    expect(changedAgo(new Date(2026, 9, 20, 9, 0).getTime(), NOW)).toBe("changed 3 days ago");
    expect(changedAgo(new Date(2026, 9, 3, 9, 0).getTime(), NOW)).toBe("changed 3 Oct");
    expect(changedAgo(new Date(2025, 0, 9, 9, 0).getTime(), NOW)).toBe("changed 9 Jan 2025");
    expect(changedAgo(null, NOW)).toBeNull();
  });
});

describe("visibleEntries (the hidden-noise filter)", () => {
  const entries = [
    entry({ name: "page 10.html" }),
    entry({ name: "node_modules", kind: "folder", noise: true }),
    entry({ name: "Page 2.html" }),
    entry({ name: ".env", noise: true }),
    entry({ name: "pictures", kind: "folder" }),
    entry({ name: "style.css" }),
  ];

  it("hides noise until Show everything, folders first, numbers in order", () => {
    expect(
      visibleEntries(entries, { showEverything: false, search: "" }).map((row) => row.name),
    ).toEqual(["pictures", "Page 2.html", "page 10.html", "style.css"]);
    expect(
      visibleEntries(entries, { showEverything: true, search: "" }).map((row) => row.name),
    ).toEqual(["node_modules", "pictures", ".env", "Page 2.html", "page 10.html", "style.css"]);
  });

  it("finds by name in any case", () => {
    expect(
      visibleEntries(entries, { showEverything: false, search: " PAGE " }).map((row) => row.name),
    ).toEqual(["Page 2.html", "page 10.html"]);
    expect(visibleEntries(entries, { showEverything: false, search: "env" })).toEqual([]);
  });

  it("counts what Show everything would add, the engine's held ones too", () => {
    expect(
      hiddenHere({
        root: "/p",
        privateCopy: false,
        path: "",
        entries,
        hiddenCount: 3,
        noiseIncluded: false,
        truncated: false,
      }),
    ).toBe(5);
  });
});

describe("the path bar", () => {
  it("walks from the project down", () => {
    expect(crumbsOf("pictures/big", "Pet page")).toEqual([
      { label: "Pet page", path: "" },
      { label: "pictures", path: "pictures" },
      { label: "big", path: "pictures/big" },
    ]);
    expect(parentOf("pictures/big")).toBe("pictures");
    expect(parentOf("pictures")).toBe("");
  });
});

describe("Quick Look notes", () => {
  it("explains code in kid words, and leaves documents alone", () => {
    expect(codeNote("style.css")).toMatch(/code behind your page/);
    expect(codeNote("game.js")).toMatch(/code behind your page/);
    expect(codeNote("notes.txt")).toBeNull();
  });
});

describe("a page's own files", () => {
  const html = [
    "<!doctype html><html><head>",
    '<link rel="stylesheet" href="style.css">',
    "<link rel='icon' href='favicon.ico'>",
    '<link href="https://fonts.example.com/a.css" rel="stylesheet">',
    "</head><body>",
    '<img src="pictures/cat.png" alt="Bubbles">',
    '<img src="https://example.com/dog.png">',
    '<img src="data:image/png;base64,AAAA">',
    '<script src="game.js?v=2" defer></script>',
    "<script>console.log('inline')</script>",
    "</body></html>",
  ].join("\n");

  it("finds the page's own styles, scripts and pictures, never the internet's", () => {
    expect(pageAssetRefs("site/index.html", html)).toEqual([
      { kind: "style", ref: "style.css", path: "site/style.css" },
      { kind: "script", ref: "game.js?v=2", path: "site/game.js" },
      { kind: "picture", ref: "pictures/cat.png", path: "site/pictures/cat.png" },
    ]);
  });

  it("resolves references inside the project only", () => {
    expect(resolvePageRef("index.html", "pictures/cat%20face.png")).toBe("pictures/cat face.png");
    expect(resolvePageRef("site/index.html", "../shared/style.css")).toBe("shared/style.css");
    expect(resolvePageRef("index.html", "../secret.css")).toBeNull();
    expect(resolvePageRef("index.html", "/style.css")).toBeNull();
    expect(resolvePageRef("index.html", "//cdn.example.com/x.js")).toBeNull();
    expect(resolvePageRef("index.html", "javascript:alert(1)")).toBeNull();
    expect(resolvePageRef("index.html", "#top")).toBeNull();
  });

  it("puts them inside the page, and leaves what it could not read as written", () => {
    const assets = new Map([
      [pageAssetKey({ kind: "style", path: "style.css" }), "h1{color:hotpink}</style><b>"],
      [pageAssetKey({ kind: "script", path: "game.js" }), "var s = '</script>';"],
      [pageAssetKey({ kind: "picture", path: "pictures/cat.png" }), "data:image/png;base64,QUJD"],
    ]);
    const out = inlinePageAssets("index.html", html, assets);
    expect(out).toContain("<style>h1{color:hotpink}<\\/style><b></style>");
    expect(out).toContain("<script defer>var s = '<\\/script>';</script>");
    expect(out).toContain('<img src="data:image/png;base64,QUJD" alt="Bubbles">');
    expect(out).toContain('<img src="https://example.com/dog.png">');
    expect(out).toContain("<link rel='icon' href='favicon.ico'>");
    expect(out).toContain("<script>console.log('inline')</script>");
    expect(inlinePageAssets("index.html", html, new Map())).toBe(html);
  });
});

describe("the engine's answers", () => {
  it("reads a listing and a file, and refuses what it doesn't understand", () => {
    const listing = parseListing({
      root: "/Users/kid/pets",
      privateCopy: true,
      path: "",
      entries: [
        { name: "a.png", path: "a.png", kind: "file", size: 3, modifiedAt: 1, noise: false },
        { name: "bad" },
      ],
      hiddenCount: 2,
      noiseIncluded: false,
      truncated: false,
    });
    expect(listing?.entries).toHaveLength(1);
    expect(listing?.hiddenCount).toBe(2);
    expect(parseListing({ entries: "nope" })).toBeNull();
    const file = parseFileRead({
      name: "a.png",
      path: "a.png",
      mode: "picture",
      mimeType: "image/png",
      size: 3,
      modifiedAt: null,
      encoding: "base64",
      contents: "QUJD",
      truncated: false,
      tooBig: false,
      absolutePath: "/Users/kid/pets/a.png",
    });
    expect(file?.mode).toBe("picture");
    expect(parseFileRead({ name: "a", path: "a", mode: "explode", absolutePath: "/" })).toBeNull();
  });
});

describe("markdownForQuickLook", () => {
  it("leaves out a new project's icon line and keeps the rest", () => {
    const readme =
      '<img src="assets/icon.svg" width="64" height="64" alt="">\n\n# Games\n\nMade with SKYCOT.\n';
    expect(markdownForQuickLook(readme)).toBe("\n# Games\n\nMade with SKYCOT.\n");
  });

  it("keeps text that only mentions a tag", () => {
    const text = "Use <b>bold</b> for names.\n`<img>` is a picture tag.";
    expect(markdownForQuickLook(text)).toBe(text);
  });
});
