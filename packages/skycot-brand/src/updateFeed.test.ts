import { describe, expect, it } from "vite-plus/test";

import {
  compareVersions,
  encodeUpdateFeed,
  isT3ReleaseUrl,
  latestMacManifestUrl,
  parseUpdateFeed,
  readManifestVersion,
  readUpdateFeedSetting,
  skycotPublishConfig,
  vetAppUpdateConfig,
} from "./updateFeed.ts";

const SKYCOT_SITE = "https://skycot.com/downloads/mac/";

describe("the brand's update feed", () => {
  it("reads no feed, a generic folder and public GitHub releases", () => {
    expect(parseUpdateFeed("none")).toEqual({ feed: null, problem: null });
    expect(parseUpdateFeed("")).toEqual({ feed: null, problem: null });
    expect(parseUpdateFeed("https://SKYCOT.com/downloads/mac").feed).toEqual({
      provider: "generic",
      url: SKYCOT_SITE,
    });
    expect(parseUpdateFeed("github:mark-hallam/skycot-releases").feed).toEqual({
      provider: "github",
      owner: "mark-hallam",
      repo: "skycot-releases",
    });
    expect(parseUpdateFeed("http://127.0.0.1:8765/feed/").feed).toEqual({
      provider: "generic",
      url: "http://127.0.0.1:8765/feed/",
    });
  });

  it("never accepts T3 Code's releases, however they are written", () => {
    for (const value of [
      "github:pingdotgg/t3code",
      "github:PingDotGG/anything",
      "github:someone/t3code",
      "https://github.com/pingdotgg/t3code/releases/latest/download/",
      "https://api.github.com/repos/pingdotgg/t3code/releases",
      "https://downloads.t3.codes/mac/",
      "https://t3.codes/",
      "https://app.t3.codes/updates/",
      "https://example.com/mirror/pingdotgg/",
    ]) {
      const parsed = parseUpdateFeed(value);
      expect(parsed.feed, value).toBeNull();
      expect(parsed.problem, value).not.toBeNull();
    }
  });

  it("refuses plain http off this computer and anything that is not a feed", () => {
    expect(parseUpdateFeed("http://skycot.com/downloads/mac/").feed).toBeNull();
    expect(parseUpdateFeed("ftp://skycot.com/").feed).toBeNull();
    expect(parseUpdateFeed("mark-hallam/skycot-product").feed).toBeNull();
  });

  it("tells an unbranded process from a branded one with no feed", () => {
    expect(readUpdateFeedSetting(undefined)).toEqual({ branded: false });
    expect(readUpdateFeedSetting("none")).toEqual({ branded: true, feed: null, problem: null });
  });

  it("round-trips through the environment value", () => {
    for (const value of ["none", SKYCOT_SITE, "github:mark-hallam/skycot-releases"]) {
      expect(encodeUpdateFeed(parseUpdateFeed(value).feed)).toBe(value);
    }
  });

  it("spots T3 release URLs", () => {
    expect(isT3ReleaseUrl("https://github.com/pingdotgg/t3code/releases")).toBe(true);
    expect(isT3ReleaseUrl("https://github.com/mark-hallam/skycot-product/releases")).toBe(false);
    expect(isT3ReleaseUrl(SKYCOT_SITE)).toBe(false);
  });
});

describe("the build's publish entry", () => {
  const branded = (value: string) =>
    readUpdateFeedSetting(value) as Extract<
      ReturnType<typeof readUpdateFeedSetting>,
      { branded: true }
    >;

  it("is nothing while SKYCOT has no feed", () => {
    expect(skycotPublishConfig(branded("none"), "latest")).toBeNull();
    expect(skycotPublishConfig(branded("github:pingdotgg/t3code"), "latest")).toBeNull();
  });

  it("is the brand's feed when there is one", () => {
    expect(skycotPublishConfig(branded(SKYCOT_SITE), "latest")).toEqual({
      provider: "generic",
      url: SKYCOT_SITE,
    });
    expect(skycotPublishConfig(branded("github:mark-hallam/skycot-releases"), "nightly")).toEqual({
      provider: "github",
      owner: "mark-hallam",
      repo: "skycot-releases",
      releaseType: "prerelease",
      channel: "nightly",
    });
  });
});

describe("the feed baked into an installed app", () => {
  const t3 = { provider: "github", owner: "pingdotgg", repo: "t3code", releaseType: "release" };
  const site = { provider: "generic", url: "https://skycot.com/downloads/mac" };

  it("refuses T3 Code's feed in every case", () => {
    for (const env of [undefined, "none", SKYCOT_SITE, "github:pingdotgg/t3code"]) {
      expect(vetAppUpdateConfig(t3, readUpdateFeedSetting(env)).allowed).toBe(false);
    }
  });

  it("refuses everything while the brand has no feed, or without the brand at all", () => {
    expect(vetAppUpdateConfig(site, readUpdateFeedSetting("none")).allowed).toBe(false);
    expect(vetAppUpdateConfig(site, readUpdateFeedSetting(undefined)).allowed).toBe(false);
  });

  it("allows only the brand's own feed", () => {
    expect(vetAppUpdateConfig(site, readUpdateFeedSetting(SKYCOT_SITE))).toEqual({
      allowed: true,
    });
    expect(
      vetAppUpdateConfig(
        { provider: "generic", url: "https://elsewhere.example/mac/" },
        readUpdateFeedSetting(SKYCOT_SITE),
      ).allowed,
    ).toBe(false);
    expect(
      vetAppUpdateConfig(
        { provider: "github", owner: "Mark-Hallam", repo: "SKYCOT-releases" },
        readUpdateFeedSetting("github:mark-hallam/skycot-releases"),
      ).allowed,
    ).toBe(true);
  });
});

describe("knowing a newer version exists", () => {
  it("finds the manifest and its version", () => {
    expect(latestMacManifestUrl({ provider: "generic", url: SKYCOT_SITE })).toBe(
      `${SKYCOT_SITE}latest-mac.yml`,
    );
    expect(latestMacManifestUrl({ provider: "github", owner: "pingdotgg", repo: "t3code" })).toBe(
      null,
    );
    expect(readManifestVersion("version: 1.4.0\nfiles:\n  - url: SKYCOT-1.4.0-arm64.zip\n")).toBe(
      "1.4.0",
    );
    expect(readManifestVersion("version: '1.4.0-beta.2'\n")).toBe("1.4.0-beta.2");
    expect(readManifestVersion("<html>not found</html>")).toBeNull();
  });

  it("orders versions", () => {
    expect(compareVersions("0.0.41", "0.0.42")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("garbage", "1.0.0")).toBe(0);
  });
});
