import { describe, expect, it } from "vite-plus/test";

import { filesFromPrompt, isInRealProjectFolder, isOutsideProject, isSecretPath } from "./files.ts";

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

  // The engine names a private copy after the project, so its path often has spaces in it.
  it("keeps a full path whole when its folders have spaces", () => {
    const copy = "/Users/kid/.t3/worktrees/Little Fern Café website/skycot-christmas-eedf";
    expect(filesFromPrompt(`add ${copy}/christmas.html\nupdate ${copy}/menu.html`)).toEqual([
      { path: `${copy}/christmas.html`, operation: "add" },
      { path: `${copy}/menu.html`, operation: "change" },
    ]);
    expect(filesFromPrompt(`Write: ${copy}/new page.html`)).toEqual([
      { path: `${copy}/new page.html`, operation: "add" },
    ]);
    expect(filesFromPrompt(`update ${copy}/old.html -> ${copy}/new.html`)).toEqual([
      { path: `${copy}/old.html`, operation: "change" },
      { path: `${copy}/new.html`, operation: "add" },
    ]);
    // A second full path on the line is its own file, never hidden behind the first.
    expect(filesFromPrompt(`update ${copy}/menu.html /etc/hosts`)).toEqual([
      { path: `${copy}/menu.html`, operation: "change" },
      { path: "/etc/hosts", operation: "change" },
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

  it("counts the thread's private copy and the project's own folder as inside", () => {
    const roots = ["/Users/me/.t3/worktrees/site/skycot-menu-1a2b", root];
    expect(isOutsideProject("/Users/me/.t3/worktrees/site/skycot-menu-1a2b/a.html", roots)).toBe(
      false,
    );
    expect(isOutsideProject("/Users/me/site/a.html", roots)).toBe(false);
    expect(isOutsideProject("/Users/me/.t3/worktrees/site/other-copy/a.html", roots)).toBe(true);
    expect(isOutsideProject("/etc/hosts", roots)).toBe(true);
    expect(isOutsideProject("/etc/hosts", [null, undefined])).toBe(true);
  });

  it("falls back to system prefixes when the root is unknown", () => {
    expect(isOutsideProject("/etc/hosts", undefined)).toBe(true);
    expect(isOutsideProject("/tmp/x", undefined)).toBe(false);
    expect(isOutsideProject("/Users/me/site/x", null)).toBe(false);
  });
});

describe("isInRealProjectFolder", () => {
  const copy = "/Users/me/.t3/worktrees/Little Fern Café website/skycot-footer-1a2b";
  const real = "/Users/me/Sites/Little Fern Café website";

  it("is true only for the real folder while a private copy is in use", () => {
    expect(isInRealProjectFolder(`${real}/index.html`, copy, real)).toBe(true);
    expect(isInRealProjectFolder(real, copy, real)).toBe(true);
    expect(isInRealProjectFolder(`${copy}/index.html`, copy, real)).toBe(false);
    expect(isInRealProjectFolder("index.html", copy, real)).toBe(false);
    expect(isInRealProjectFolder("/etc/hosts", copy, real)).toBe(false);
    expect(isInRealProjectFolder(`${real} old/index.html`, copy, real)).toBe(false);
  });

  it("is false without a private copy", () => {
    expect(isInRealProjectFolder(`${real}/index.html`, real, real)).toBe(false);
    expect(isInRealProjectFolder(`${real}/index.html`, `${real}/`, real)).toBe(false);
    expect(isInRealProjectFolder(`${real}/index.html`, null, real)).toBe(false);
    expect(isInRealProjectFolder(`${real}/index.html`, copy, null)).toBe(false);
  });

  it("counts a private copy kept inside the project folder as the copy", () => {
    const nested = `${real}/.skycot/copies/footer`;
    expect(isInRealProjectFolder(`${nested}/index.html`, nested, real)).toBe(false);
    expect(isInRealProjectFolder(`${real}/index.html`, nested, real)).toBe(true);
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
