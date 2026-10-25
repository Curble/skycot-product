// nondev-seam: skycot-page-play-policy-test
import { describe, expect, it } from "vite-plus/test";

import {
  cleanPagePath,
  cleanSites,
  MAX_PAGE_SITES,
  pageServerPolicy,
  pageServerFallbackPolicy,
  sealedPolicy,
  BLOCKED_REPORTER,
  reportedSite,
  siteOf,
  siteOfUrl,
  sitesForPage,
  withAllowed,
  readBlockedReport,
  withHeadStart,
} from "./pageInternet.ts";

describe("siteOf", () => {
  it("names the site a grown-up recognises", () => {
    expect(siteOf("images.dog.ceo")).toBe("dog.ceo");
    expect(siteOf("dog.ceo")).toBe("dog.ceo");
    expect(siteOf("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(siteOf("api.abc.net.au")).toBe("abc.net.au");
    expect(siteOf("Upload.Wikimedia.org.")).toBeNull();
  });

  it("uses the private, wildcard and exception rules in the Public Suffix List", () => {
    expect(siteOf("alice.github.io")).toBe("alice.github.io");
    expect(cleanSites(["alice.github.io", "bob.github.io"])).toEqual([
      "alice.github.io",
      "bob.github.io",
    ]);
    expect(siteOf("foo.s3.amazonaws.com")).toBe("foo.s3.amazonaws.com");
    expect(siteOf("a.b.ck")).toBe("a.b.ck");
    expect(siteOf("www.ck")).toBe("www.ck");
    expect(siteOf("a.www.ck")).toBe("www.ck");
    expect(pageServerPolicy(["alice.github.io"])).toContain("https://*.alice.github.io");
    expect(pageServerPolicy(["alice.github.io"])).not.toContain("*.github.io");
  });

  it("is never a local or numeric address", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.2",
      "::1",
      "[::1]",
      "printer.local",
      "x.localhost",
      "com",
      "co.uk",
      "",
    ]) {
      expect(siteOf(host)).toBeNull();
    }
    expect(siteOfUrl("https://images.dog.ceo/breeds/a.jpg")).toBe("dog.ceo");
    expect(siteOfUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(siteOfUrl("not a url")).toBeNull();
    expect(siteOfUrl("https://user@cdn.example.com:8443/x?y")).toBe("example.com");
    expect(siteOfUrl("ftp://dog.ceo/x")).toBeNull();
  });

  it("rejects malformed host spellings without canonicalizing them into approvals", () => {
    for (const host of [
      "Dog.ceo",
      "dog.ceo.",
      "xn--bcher-kva.example",
      "éxample.com",
      `${"a".repeat(64)}.com`,
      `${"a.".repeat(130)}com`,
    ]) {
      expect(siteOf(host)).toBeNull();
    }
  });

  it("keeps a short, clean list", () => {
    expect(cleanSites(["images.dog.ceo", "dog.ceo", 3, "localhost", "b.org", "a.org"])).toEqual([
      "a.org",
      "b.org",
      "dog.ceo",
    ]);
    const many = Array.from({ length: 20 }, (_, index) => `site${index}.com`);
    expect(cleanSites(many)).toHaveLength(MAX_PAGE_SITES);
  });
});

describe("reportedSite", () => {
  it("accepts only the reporter's public https sites", () => {
    expect(
      reportedSite(
        JSON.stringify({
          skycot: "page-internet",
          url: "https://images.dog.ceo",
          directive: "img-src",
        }),
      ),
    ).toBe("dog.ceo");
    expect(
      reportedSite({ skycot: "page-internet", url: "http://dog.ceo", directive: "img-src" }),
    ).toBeNull();
    expect(
      reportedSite({ skycot: "page-internet", url: "https://127.0.0.1", directive: "img-src" }),
    ).toBeNull();
    expect(reportedSite({ skycot: "page-internet", url: "https://dog.ceo" })).toBeNull();
    expect(
      reportedSite({
        skycot: "page-internet",
        url: "https://dog.ceo",
        directive: "img-src",
        extra: true,
      }),
    ).toBeNull();
    expect(reportedSite("not json")).toBeNull();
  });
});

describe("cleanPagePath", () => {
  it("takes one absolute .html file, with no way out", () => {
    expect(cleanPagePath("/Users/ava/game/index.html")).toBe("/Users/ava/game/index.html");
    expect(cleanPagePath("/Users/ava//game/dog.htm")).toBe("/Users/ava/game/dog.htm");
    expect(cleanPagePath("game/index.html")).toBeNull();
    expect(cleanPagePath("/Users/ava/../bob/index.html")).toBeNull();
    expect(cleanPagePath("/Users/ava/game/app.js")).toBeNull();
    expect(cleanPagePath(42)).toBeNull();
  });
});

describe("pageServerPolicy", () => {
  it("is offline with no sites, and opens only pictures, sounds, fonts and data for allowed ones", () => {
    const offline = pageServerPolicy([]);
    expect(offline).not.toContain("https:");
    const open = pageServerPolicy(["dog.ceo"]);
    for (const directive of ["img-src", "media-src", "font-src", "connect-src"]) {
      expect(open).toMatch(new RegExp(`${directive} [^;]*https://\\*\\.dog\\.ceo`, "u"));
    }
    for (const directive of ["script-src", "frame-src", "form-action", "default-src"]) {
      expect(open.match(new RegExp(`${directive} [^;]*`, "u"))![0]).not.toContain("dog.ceo");
    }
    expect(open).toContain("form-action 'none'");
    const capped = pageServerFallbackPolicy([]).match(/script-src [^;]*/u)?.[0] ?? "";
    expect(capped).toBe("script-src 'self'");
    expect(capped).not.toContain("'unsafe-inline'");
    expect(capped).not.toContain("blob:");
    expect(capped).not.toContain("'unsafe-eval'");
  });

  it("never lets a hand-made site name widen the policy", () => {
    const policy = pageServerPolicy(["*", "https:", "dog.ceo; script-src *", "'unsafe-inline'"]);
    expect(policy).not.toContain("script-src *");
    expect(policy).not.toMatch(/img-src [^;]* \* /u);
  });
});

describe("sealed playable policy", () => {
  it("allows local code and only allowed data sources, never frames or forms", () => {
    const policy = sealedPolicy(["dog.ceo"]);
    for (const directive of ["img-src", "media-src", "font-src", "connect-src"]) {
      expect(policy.match(new RegExp(`${directive} [^;]*`, "u"))?.[0]).toContain("dog.ceo");
    }
    for (const directive of ["script-src", "frame-src", "form-action", "default-src"]) {
      expect(policy.split("; ").find((part) => part.startsWith(directive))).not.toContain(
        "dog.ceo",
      );
    }
    expect(policy).toContain("script-src");
    const scriptPolicy = policy.split("; ").find((part) => part.startsWith("script-src")) ?? "";
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    expect(scriptPolicy).not.toMatch(/\b(?:data|blob):/u);
    expect(sealedPolicy([])).not.toContain("https:");
    const pinned = sealedPolicy([], ["script-hash"], ["click-hash"]);
    expect(pinned).toContain("script-src 'sha256-script-hash' 'sha256-click-hash' 'unsafe-hashes'");
    expect(pageServerPolicy([], ["script-hash"], ["click-hash"])).toContain(
      "'self' 'sha256-script-hash' 'sha256-click-hash' 'unsafe-hashes'",
    );
  });

  it("reports the same message to the web parent or phone bridge", () => {
    expect(BLOCKED_REPORTER).toContain("window.parent.postMessage(m,'*')");
    expect(BLOCKED_REPORTER).toContain("window.ReactNativeWebView.postMessage(JSON.stringify(m))");
    expect(BLOCKED_REPORTER).toContain(
      "skycot:'page-internet',url:u.origin,directive:String(e.effectiveDirective||'')",
    );
  });
});

describe("allowed pages", () => {
  const page = "/Users/ava/game/index.html";

  it("adds sites to what the page had and keeps other pages apart", () => {
    const first = withAllowed([], page, ["dog.ceo"], 1);
    const second = withAllowed(first, page, ["images.dog.ceo", "cataas.com"], 2);
    expect(sitesForPage(second, page)).toEqual(["cataas.com", "dog.ceo"]);
    expect(sitesForPage(second, "/Users/ava/game/other.html")).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it("puts the reporter first in the head", () => {
    expect(withHeadStart("<html><head><title>x</title>", "<s>")).toBe(
      "<html><head><s><title>x</title>",
    );
    expect(withHeadStart("<!doctype html><p>x", "<s>")).toBe("<!doctype html><s><p>x");
    expect(withHeadStart("<p>x", "<s>")).toBe("<s><p>x");
  });
});

describe("readBlockedReport", () => {
  it("reads the page path and the site, https only", () => {
    const report = (document: string, blocked: string) =>
      JSON.stringify({ "csp-report": { "document-uri": document, "blocked-uri": blocked } });
    expect(
      readBlockedReport(
        report("http://127.0.0.1:5000/pets/dog.html?x=1", "https://images.dog.ceo/a"),
      ),
    ).toEqual({ pagePath: "/pets/dog.html", site: "dog.ceo" });
    expect(readBlockedReport(report("http://127.0.0.1:5000", "https://dog.ceo"))).toEqual({
      pagePath: "/",
      site: "dog.ceo",
    });
    expect(readBlockedReport(report("http://127.0.0.1:5000/", "http://dog.ceo/x"))).toBeNull();
    expect(readBlockedReport(report("http://127.0.0.1:5000/", "inline"))).toBeNull();
    expect(readBlockedReport("not json")).toBeNull();
  });
});
// nondev-seam: skycot-page-play-policy-test
