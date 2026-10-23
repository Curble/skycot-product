import { describe, expect, it } from "vite-plus/test";

import {
  cleanBrowsePath,
  FILE_KIND_LABEL,
  fileKindOf,
  isNoiseName,
  mimeTypeOf,
  pathHasNoise,
  pathIsHiddenOrSecret,
  quickLookModeOf,
} from "./browse.ts";

describe("fileKindOf", () => {
  it("names files the way a person would", () => {
    const label = (name: string, folder = false) => FILE_KIND_LABEL[fileKindOf(name, folder)];
    expect(label("index.html")).toBe("Page");
    expect(label("menu.HTM")).toBe("Page");
    expect(label("pictures/cat.PNG")).toBe("Picture");
    expect(label("logo.svg")).toBe("Picture");
    expect(label("style.css")).toBe("Style");
    expect(label("story.pdf")).toBe("Document");
    expect(label("notes.md")).toBe("Document");
    expect(label("shopping.txt")).toBe("Document");
    expect(label("README")).toBe("Document");
    expect(label("letter.docx")).toBe("Document");
    expect(label("game.js")).toBe("Code");
    expect(label("package.json")).toBe("Code");
    expect(label("main.py")).toBe("Code");
    expect(label("boing.mp3")).toBe("Sound");
    expect(label("clip.mov")).toBe("Video");
    expect(label("archive.zip")).toBe("File");
    expect(label("Makefile.bak")).toBe("File");
    expect(label("pictures", true)).toBe("Folder");
    expect(label("index.html", true)).toBe("Folder");
  });
});

describe("quickLookModeOf", () => {
  it("shows pictures, pages, PDFs, Markdown, sound and text, and nothing it cannot", () => {
    expect(quickLookModeOf("cat.jpeg")).toBe("picture");
    expect(quickLookModeOf("index.html")).toBe("page");
    expect(quickLookModeOf("story.pdf")).toBe("pdf");
    expect(quickLookModeOf("README.md")).toBe("markdown");
    expect(quickLookModeOf("boing.wav")).toBe("media");
    expect(quickLookModeOf("clip.mp4")).toBe("media");
    expect(quickLookModeOf("style.css")).toBe("text");
    expect(quickLookModeOf("game.ts")).toBe("text");
    expect(quickLookModeOf("LICENSE")).toBe("text");
    expect(quickLookModeOf(".gitignore")).toBe("text");
    expect(quickLookModeOf("letter.docx")).toBe("none");
    expect(quickLookModeOf("archive.zip")).toBe("none");
    expect(quickLookModeOf("program")).toBe("none");
  });

  it("gives the client a media type to build the picture or document from", () => {
    expect(mimeTypeOf("cat.JPG")).toBe("image/jpeg");
    expect(mimeTypeOf("story.pdf")).toBe("application/pdf");
    expect(mimeTypeOf("logo.svg")).toBe("image/svg+xml");
    expect(mimeTypeOf("notes.txt")).toBe("text/plain");
  });
});

describe("the hidden-noise filter", () => {
  it("hides add-ons, build output, hidden files, system litter and keys", () => {
    for (const [name, folder] of [
      ["node_modules", true],
      ["dist", true],
      ["build", true],
      ["__pycache__", true],
      [".git", true],
      [".next", true],
      [".env", false],
      [".env.local", false],
      [".DS_Store", false],
      ["Thumbs.db", false],
      ["server.pem", false],
      ["private.KEY", false],
    ] as const) {
      expect(isNoiseName(name, folder), name).toBe(true);
    }
  });

  it("keeps the child's own work", () => {
    for (const [name, folder] of [
      ["index.html", false],
      ["pictures", true],
      ["style.css", false],
      ["build-a-rocket.html", false],
      // Only a folder called "build" is build output; a file of that name is someone's work.
      ["build", false],
      ["src", true],
      ["My Story.pdf", false],
    ] as const) {
      expect(isNoiseName(name, folder), name).toBe(false);
    }
  });

  it("judges a whole path by every folder on the way", () => {
    expect(pathHasNoise("node_modules/react/index.js", false)).toBe(true);
    expect(pathHasNoise("site/.git/config", false)).toBe(true);
    expect(pathHasNoise(".env", false)).toBe(true);
    expect(pathHasNoise("pictures/cat.png", false)).toBe(false);
    expect(pathHasNoise("pictures", true)).toBe(false);
    expect(pathHasNoise("", true)).toBe(false);
  });
});

describe("pathIsHiddenOrSecret", () => {
  it("catches hidden and secret files wherever they are, but not add-ons or build output", () => {
    expect(pathIsHiddenOrSecret(".env")).toBe(true);
    expect(pathIsHiddenOrSecret("site/.git/config")).toBe(true);
    expect(pathIsHiddenOrSecret("certs/server.pem")).toBe(true);
    expect(pathIsHiddenOrSecret("index.html")).toBe(false);
    expect(pathIsHiddenOrSecret("build/index.html")).toBe(false);
    expect(pathIsHiddenOrSecret("node_modules/react/index.js")).toBe(false);
  });
});

describe("cleanBrowsePath", () => {
  it("accepts project-relative paths and tidies their slashes", () => {
    expect(cleanBrowsePath(undefined)).toBe("");
    expect(cleanBrowsePath("")).toBe("");
    expect(cleanBrowsePath("pictures/cat.png")).toBe("pictures/cat.png");
    expect(cleanBrowsePath("pictures//cat.png/")).toBe("pictures/cat.png");
    expect(cleanBrowsePath("My Story.pdf")).toBe("My Story.pdf");
    expect(cleanBrowsePath("..hidden-name")).toBe("..hidden-name");
  });

  it("refuses every way out of the project", () => {
    for (const raw of [
      "../secrets.txt",
      "pictures/../../etc/passwd",
      "..",
      "./index.html",
      "/etc/passwd",
      "/Users/kid/Documents",
      "~/Documents",
      "~",
      "C:\\Windows",
      "c:/Windows",
      "pictures\\..\\..\\etc",
      "cat.png\u0000.txt",
      "line\nbreak",
      "a".repeat(2000),
      42,
      { path: "x" },
    ]) {
      expect(cleanBrowsePath(raw), String(raw).slice(0, 40)).toBeNull();
    }
  });
});
