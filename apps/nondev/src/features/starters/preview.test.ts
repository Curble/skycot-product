import { describe, expect, it } from "vite-plus/test";

import { OFFLINE_POLICY, offlinePreviewDocument, previewablePage } from "./preview";

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
