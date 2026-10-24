import { describe, expect, it } from "vite-plus/test";

import type { PreviewStatusView } from "../preview/model";
import {
  OFFLINE_POLICY,
  offlinePreviewDocument,
  openItChoice,
  pathInPageSite,
  previewablePage,
  previewPageUrl,
  usesModules,
} from "./preview";

const pageServer = (pageFolder: string) => ({
  runner: "SKYCOT's built-in page server",
  script: pageFolder.length > 0 ? `${pageFolder}/index.html` : "index.html",
  page: true as const,
  pageFolder,
});
const readyPage = (pageFolder = ""): PreviewStatusView => ({
  state: "ready",
  command: pageServer(pageFolder),
  decision: { kind: "start" },
  requestId: "skycot-preview:1",
});
const mac = { canShowPreviewHere: true };

describe("Open it: the Preview or the sealed frame", () => {
  it("opens Ava's rocket (index.html, style.css, rocket.js importing three.module.js) in the Preview", () => {
    expect(openItChoice({ page: "index.html", status: readyPage(), ...mac })).toEqual({
      kind: "preview",
      path: "/",
    });
  });

  it("opens the page itself when it is in a subfolder, or not the first page", () => {
    expect(
      openItChoice({ page: "public/index.html", status: readyPage("public"), ...mac }),
    ).toEqual({ kind: "preview", path: "/" });
    expect(openItChoice({ page: "games/rocket.html", status: readyPage(), ...mac })).toEqual({
      kind: "preview",
      path: "/games/rocket.html",
    });
    expect(openItChoice({ page: "my game.html", status: readyPage(), ...mac })).toEqual({
      kind: "preview",
      path: "/my%20game.html",
    });
  });

  it("uses the Preview that is already showing, or starting", () => {
    const running: PreviewStatusView = {
      state: "running",
      command: pageServer(""),
      url: "http://127.0.0.1:52011/",
      frameable: true,
    };
    expect(openItChoice({ page: "about.html", status: running, ...mac })).toEqual({
      kind: "preview",
      path: "/about.html",
    });
    expect(
      openItChoice({
        page: "index.html",
        status: { state: "starting", command: pageServer("") },
        ...mac,
      }),
    ).toEqual({ kind: "preview", path: "/" });
  });

  it("keeps the sealed frame where the Preview can't show that page", () => {
    // Outside the folder the page server shows.
    expect(openItChoice({ page: "index.html", status: readyPage("public"), ...mac }).kind).toBe(
      "sealed",
    );
    // No index.html anywhere: no page server (a starter's one-file my-game.html).
    expect(openItChoice({ page: "my-game.html", status: { state: "no-site" }, ...mac }).kind).toBe(
      "sealed",
    );
    expect(openItChoice({ page: "x.html", status: { state: "no-folder" }, ...mac }).kind).toBe(
      "sealed",
    );
    // The page server couldn't show it.
    expect(
      openItChoice({
        page: "index.html",
        status: { state: "failed", command: pageServer(""), reason: "exited", output: "" },
        ...mac,
      }).kind,
    ).toBe("sealed");
    // The engine didn't answer.
    expect(openItChoice({ page: "index.html", status: null, ...mac }).kind).toBe("sealed");
  });

  it("never starts a project's own start command, so never asks a question", () => {
    const site = { runner: "npm run dev", script: "vite" };
    for (const decision of [
      { kind: "start" as const },
      { kind: "ask" as const, reasons: [] },
      { kind: "grown-up" as const, reasons: ["installs something"] },
    ]) {
      expect(
        openItChoice({
          page: "index.html",
          status: { state: "ready", command: site, decision, requestId: "r" },
          ...mac,
        }).kind,
      ).toBe("sealed");
    }
    expect(
      openItChoice({
        page: "index.html",
        status: { state: "running", command: site, url: "http://localhost:5173/", frameable: true },
        ...mac,
      }).kind,
    ).toBe("sealed");
  });

  it("uses the sealed frame on a phone, where the Mac's own address doesn't work", () => {
    expect(
      openItChoice({ page: "index.html", status: readyPage(), canShowPreviewHere: false }).kind,
    ).toBe("sealed");
  });
});

describe("pathInPageSite", () => {
  it("never names a page outside the shown folder, or one the page server refuses", () => {
    expect(pathInPageSite("../secret.html", "")).toBeNull();
    expect(pathInPageSite("games/../../x.html", "")).toBeNull();
    expect(pathInPageSite("/Users/ava/x.html", "")).toBeNull();
    expect(pathInPageSite(".cache/x.html", "")).toBeNull();
    expect(pathInPageSite("dist/index.html", "public")).toBeNull();
    expect(pathInPageSite("public", "public")).toBeNull();
    expect(pathInPageSite("notes.txt", "")).toBeNull();
    expect(pathInPageSite("./public/about.html", "public")).toBe("/about.html");
    expect(pathInPageSite("games/index.html", "")).toBe("/games/index.html");
  });
});

describe("previewPageUrl", () => {
  it("puts the page on the site's own address, and nowhere else", () => {
    expect(previewPageUrl("http://127.0.0.1:52011/", "/games/rocket.html")).toBe(
      "http://127.0.0.1:52011/games/rocket.html",
    );
    expect(previewPageUrl("http://127.0.0.1:52011/", null)).toBe("http://127.0.0.1:52011/");
    expect(previewPageUrl("http://127.0.0.1:52011/", "//example.com/x")).toBe(
      "http://127.0.0.1:52011/",
    );
  });
});

describe("usesModules", () => {
  it("knows a page whose script imports other files", () => {
    expect(usesModules('<script type="module" src="rocket.js"></script>')).toBe(true);
    expect(usesModules("<script type=module>import x from './x.js'</script>")).toBe(true);
    expect(usesModules('<script src="game.js"></script>')).toBe(false);
  });
});

describe("previewable page", () => {
  it("opens the new page a starter made", () => {
    expect(
      previewablePage([
        { path: "styles.css", operation: "edited" },
        { path: "birthday-card.html", operation: "added" },
        { path: "index.html", operation: "edited" },
      ]),
    ).toBe("birthday-card.html");
  });

  it("falls back to a changed page, index first", () => {
    expect(
      previewablePage([
        { path: "about.html", operation: "edited" },
        { path: "site/index.html", operation: "edited" },
      ]),
    ).toBe("site/index.html");
  });

  it("offers nothing when no page changed or the page was deleted", () => {
    expect(previewablePage([{ path: "app.js", operation: "edited" }])).toBeNull();
    expect(previewablePage([{ path: "old.html", operation: "deleted" }])).toBeNull();
  });
});

describe("offline preview document", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_POLICY}">`;

  it("puts the offline policy first in the head, before any of the page's scripts", () => {
    const page = '<!doctype html><html><head><script src="https://x.test/a.js"></script></head>';
    const out = offlinePreviewDocument(page);
    expect(out.indexOf(meta)).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf(meta)).toBeLessThan(out.indexOf("<script src"));
  });

  it("keeps the doctype first when the page has no head", () => {
    const out = offlinePreviewDocument("<!DOCTYPE html><p>Hi</p>");
    expect(out.startsWith(`<!DOCTYPE html>${meta}`)).toBe(true);
  });

  it("works for a bare fragment", () => {
    expect(offlinePreviewDocument("<p>Hi</p>").startsWith(meta)).toBe(true);
  });

  it("blocks the network and allows only inline code and data pictures", () => {
    expect(OFFLINE_POLICY).toContain("default-src 'none'");
    expect(OFFLINE_POLICY).toContain("connect-src 'none'");
    expect(OFFLINE_POLICY).not.toMatch(/https?:|\*/);
  });
});
