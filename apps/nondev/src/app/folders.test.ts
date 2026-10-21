import { describe, expect, it } from "vite-plus/test";

import {
  defaultBrowseStart,
  folderCrumbs,
  folderGuard,
  homeDirectoryFrom,
  plainFolderPath,
  sameFolder,
  visibleEntries,
} from "./folders";

describe("folderGuard", () => {
  const home = "/Users/mark";

  it("refuses the disk, the accounts folder and the home folder", () => {
    expect(folderGuard("/", home).kind).toBe("refuse");
    expect(folderGuard("/Users", home).kind).toBe("refuse");
    expect(folderGuard("/Users/mark", home).kind).toBe("refuse");
    expect(folderGuard("/Users/mark/", home).kind).toBe("refuse");
    expect(folderGuard("/Volumes", home).kind).toBe("refuse");
  });

  it("refuses system trees and the Library", () => {
    for (const path of [
      "/private/var/root",
      "/System/Library",
      "/Applications/Safari.app",
      "/usr/local",
      "/etc",
      "/Users/mark/Library",
      "/Users/mark/Library/Keychains",
    ]) {
      expect(folderGuard(path, home).kind, path).toBe("refuse");
    }
  });

  it("warns on the broad catch-all folders and iCloud Drive", () => {
    expect(folderGuard("/Users/mark/Documents", home)).toMatchObject({ kind: "warn" });
    expect(folderGuard("/Users/mark/Desktop/", home)).toMatchObject({ kind: "warn" });
    expect(
      folderGuard("/Users/mark/Library/Mobile Documents/com~apple~CloudDocs", home),
    ).toMatchObject({ kind: "warn" });
  });

  it("allows real project folders, including inside Documents and iCloud Drive", () => {
    expect(folderGuard("/Users/mark/Documents/cafe-site", home)).toEqual({ kind: "ok" });
    expect(folderGuard("/Users/mark/Sites/cafe", home)).toEqual({ kind: "ok" });
    expect(
      folderGuard("/Users/mark/Library/Mobile Documents/com~apple~CloudDocs/cafe", home),
    ).toEqual({ kind: "ok" });
    expect(folderGuard("/Volumes/Work/cafe", home)).toEqual({ kind: "ok" });
  });

  it("works out the home folder from the path when none is known", () => {
    expect(folderGuard("/Users/someone", null).kind).toBe("refuse");
    expect(folderGuard("/home/someone/Library", null).kind).toBe("refuse");
    expect(folderGuard("/home/someone/site", null)).toEqual({ kind: "ok" });
  });

  it("handles Windows paths", () => {
    expect(folderGuard("C:\\", null).kind).toBe("refuse");
    expect(folderGuard("C:\\Windows\\System32", null).kind).toBe("refuse");
    expect(folderGuard("C:\\Users", null).kind).toBe("refuse");
    expect(folderGuard("C:\\Users\\Mark", null).kind).toBe("refuse");
    expect(folderGuard("C:\\Users\\Mark\\AppData\\Local", null).kind).toBe("refuse");
    expect(folderGuard("C:\\Users\\Mark\\Documents", null).kind).toBe("warn");
    expect(folderGuard("C:\\Users\\Mark\\Documents\\cafe", null)).toEqual({ kind: "ok" });
  });
});

describe("homeDirectoryFrom", () => {
  it("finds the home under macOS, Linux and Windows layouts", () => {
    expect(homeDirectoryFrom("/Users/mark/t3code/apps/server")).toBe("/Users/mark");
    expect(homeDirectoryFrom("/home/mark/code")).toBe("/home/mark");
    expect(homeDirectoryFrom("C:\\Users\\Mark\\code")).toBe("C:\\Users\\Mark");
    expect(homeDirectoryFrom("/opt/t3")).toBeNull();
    expect(homeDirectoryFrom("/Users/Shared/x")).toBeNull();
  });
});

describe("crumbs and plain paths", () => {
  it("reads the home folder as Home and the disk as This Mac", () => {
    expect(folderCrumbs("/Users/mark/Sites/cafe/", "/Users/mark")).toEqual([
      "Home",
      "Sites",
      "cafe",
    ]);
    expect(folderCrumbs("/Users/mark", "/Users/mark")).toEqual(["Home"]);
    expect(folderCrumbs("/Volumes/Work", "/Users/mark")).toEqual(["This Mac", "Volumes", "Work"]);
    expect(folderCrumbs("/", null)).toEqual(["This Mac"]);
    expect(plainFolderPath("/Users/mark/Sites/cafe")).toBe("Home › Sites › cafe");
  });
});

describe("visibleEntries and sameFolder", () => {
  it("hides dot-folders unless asked", () => {
    const entries = [
      { name: ".git", fullPath: "/p/.git" },
      { name: "src", fullPath: "/p/src" },
    ];
    expect(visibleEntries(entries, false).map((entry) => entry.name)).toEqual(["src"]);
    expect(visibleEntries(entries, true)).toHaveLength(2);
  });

  it("ignores trailing separators and Windows case when comparing", () => {
    expect(sameFolder("/Users/mark/cafe/", "/Users/mark/cafe")).toBe(true);
    expect(sameFolder("/Users/mark/cafe", "/Users/mark/cafe2")).toBe(false);
    expect(sameFolder("C:\\Users\\Mark\\Cafe\\", "c:/users/mark/cafe")).toBe(true);
  });
});

describe("defaultBrowseStart", () => {
  it("prefers what was browsed last, then the last project's parent, then home", () => {
    expect(
      defaultBrowseStart({ remembered: "/Users/mark/Sites/", lastProjectRoot: null, cwd: null }),
    ).toBe("/Users/mark/Sites/");
    expect(
      defaultBrowseStart({
        remembered: null,
        lastProjectRoot: "/Users/mark/Sites/cafe",
        cwd: null,
      }),
    ).toBe("/Users/mark/Sites/");
    expect(
      defaultBrowseStart({
        remembered: null,
        lastProjectRoot: null,
        cwd: "/Users/mark/t3code/apps/server",
      }),
    ).toBe("/Users/mark/");
    expect(defaultBrowseStart({ remembered: null, lastProjectRoot: null, cwd: "/srv/t3" })).toBe(
      "/srv/t3",
    );
  });
});
