import { describe, expect, it } from "vite-plus/test";

import { filesFromPrompt, isOutsideProject, isSecretPath } from "./files.ts";

describe("filesFromPrompt", () => {
  it("reads Codex verb lines, Claude tool prefixes, bare paths and 'N files:' lists", () => {
    expect(
      filesFromPrompt("update /a/book.html\nadd /a/new.html\ndelete /a/old.html\n+3 more"),
    ).toEqual([
      { path: "/a/book.html", operation: "change" },
      { path: "/a/new.html", operation: "add" },
      { path: "/a/old.html", operation: "remove" },
    ]);
    expect(filesFromPrompt("Write: /a/new.html")).toEqual([
      { path: "/a/new.html", operation: "add" },
    ]);
    expect(filesFromPrompt("Read: /etc/hosts")).toEqual([
      { path: "/etc/hosts", operation: "change" },
    ]);
    expect(filesFromPrompt("src/pages/booking.tsx")).toEqual([
      { path: "src/pages/booking.tsx", operation: "change" },
    ]);
    expect(filesFromPrompt("Edit 2 files: index.html, menu.html")).toEqual([
      { path: "index.html", operation: "change" },
      { path: "menu.html", operation: "change" },
    ]);
    expect(filesFromPrompt("update /a/old.html -> /a/new.html")).toEqual([
      { path: "/a/old.html", operation: "change" },
      { path: "/a/new.html", operation: "add" },
    ]);
  });

  it("ignores prose and empty prompts", () => {
    expect(filesFromPrompt(undefined)).toEqual([]);
    expect(filesFromPrompt("Allow the  assistant to  edit the booking page")).toEqual([]);
    expect(filesFromPrompt("Edit the booking page")).toEqual([]);
    expect(filesFromPrompt("update christmas")).toEqual([
      { path: "christmas", operation: "change" },
    ]);
  });
});

describe("isOutsideProject", () => {
  const root = "/Users/me/site";
  it("judges absolute paths against the root and relative paths by `..`", () => {
    expect(isOutsideProject("/Users/me/site/index.html", root)).toBe(false);
    expect(isOutsideProject("/Users/me/site-two/index.html", root)).toBe(true);
    expect(isOutsideProject("/etc/hosts", root)).toBe(true);
    expect(isOutsideProject("src/index.html", root)).toBe(false);
    expect(isOutsideProject("../other/index.html", root)).toBe(true);
    expect(isOutsideProject("~/.zshrc", root)).toBe(true);
    expect(isOutsideProject("/dev/null", root)).toBe(false);
  });

  it("falls back to system prefixes when the root is unknown", () => {
    expect(isOutsideProject("/etc/hosts", undefined)).toBe(true);
    expect(isOutsideProject("/tmp/x", undefined)).toBe(false);
    expect(isOutsideProject("/Users/me/site/x", null)).toBe(false);
  });
});

describe("isSecretPath", () => {
  it.each([
    ".env",
    ".env.local",
    "config/.env.production",
    "id_rsa",
    "~/.ssh/id_ed25519",
    "server.pem",
    "creds/credentials.json",
    "~/.aws/credentials",
  ])("%s", (path) => expect(isSecretPath(path)).toBe(true));
  it.each([".env.example", "src/index.html", "README.md", "envelope.ts"])("not %s", (path) =>
    expect(isSecretPath(path)).toBe(false),
  );
});
