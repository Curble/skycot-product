import { describe, expect, it } from "vite-plus/test";

import { offlinePreviewDocument, OFFLINE_POLICY, sealedPolicy } from "../starters/preview";
import { pageName, sitesSentence } from "./PageInternetAsk";
import { reportedSite } from "./useSealedInternet";

describe("the sealed frame and the internet", () => {
  it("stays offline with no allowed sites, and opens only pictures, sounds, fonts and data", () => {
    expect(sealedPolicy()).toBe(OFFLINE_POLICY);
    const open = sealedPolicy(["images.dog.ceo"]);
    expect(open).toContain("img-src data: blob: https://dog.ceo https://*.dog.ceo");
    expect(open).toContain("connect-src https://dog.ceo https://*.dog.ceo");
    expect(open).toContain("script-src 'unsafe-inline';");
    expect(open).toContain("frame-src 'none'");
    expect(sealedPolicy(["*", "dog.ceo; script-src *"])).not.toContain("script-src *");
  });

  it("puts the policy and the reporter first in the page", () => {
    const html = offlinePreviewDocument("<html><head><title>Dogs</title>", ["dog.ceo"]);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>"));
    expect(html).toContain("securitypolicyviolation");
    expect(html).toContain("https://*.dog.ceo");
  });

  it("only counts the reporter's https addresses", () => {
    expect(reportedSite({ skycot: "page-internet", url: "https://images.dog.ceo" })).toBe(
      "dog.ceo",
    );
    expect(reportedSite({ skycot: "page-internet", url: "http://dog.ceo" })).toBeNull();
    expect(reportedSite({ skycot: "other", url: "https://dog.ceo" })).toBeNull();
    expect(reportedSite("https://dog.ceo")).toBeNull();
    expect(reportedSite({ skycot: "page-internet", url: "https://127.0.0.1:3000" })).toBeNull();
  });

  it("names the sites and the page plainly", () => {
    expect(sitesSentence(["dog.ceo"])).toBe("dog.ceo");
    expect(sitesSentence(["a.org", "b.org", "c.org"])).toBe("a.org, b.org and c.org");
    expect(pageName("/Users/ava/pets/dog.html")).toBe("dog.html");
  });
});
