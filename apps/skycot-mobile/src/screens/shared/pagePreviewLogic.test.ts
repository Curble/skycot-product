// nondev-seam: skycot-mobile-page-logic-test
import { describe, expect, it } from "vite-plus/test";
import { MAX_PAGE_SITES } from "@t3tools/skycot-rules/page-internet";

import {
  allowsPlayNavigation,
  GAME_BUTTONS_DEFAULT,
  GAME_KEY_SCRIPTS,
  gameButtonsForPage,
  playableCopy,
  pageAskWaitingCopy,
  reportedSites,
} from "./pagePreviewLogic";

describe("the sealed page viewer", () => {
  it("uses the playable copy only when the engine returned HTML", () => {
    const playable = {
      html: "<script>game()</script>",
      reason: null,
      page: "/a/game.html",
    } as const;
    expect(playableCopy({ ok: true, value: playable })).toBe(playable);
    expect(
      playableCopy({ ok: true, value: { html: null, reason: "too-big", page: "/a/game.html" } }),
    ).toBeNull();
    expect(playableCopy({ ok: false })).toBeNull();
  });

  it("allows navigation only to the viewer's own document", () => {
    for (const url of ["about:blank", "about:srcdoc"]) {
      expect(allowsPlayNavigation(url)).toBe(true);
    }
    for (const url of [
      "http://example.com",
      "https://example.com",
      "file:///tmp/a",
      "javascript:alert(1)",
      "mailto:a@b.test",
      "data:text/html,<script>fetch(1)</script>",
      "blob:https://x.test/id",
      "about:blank.evil.test",
    ]) {
      expect(allowsPlayNavigation(url)).toBe(false);
    }
  });

  it("collects only unique public https reporter sites", () => {
    const report = JSON.stringify({
      skycot: "page-internet",
      url: "https://images.dog.ceo",
      directive: "img-src",
    });
    expect(reportedSites(report, [])).toEqual(["dog.ceo"]);
    expect(
      reportedSites({ skycot: "anything", url: "https://example.com", directive: "img-src" }, []),
    ).toEqual([]);
    expect(
      reportedSites(
        { skycot: "page-internet", url: "http://example.com", directive: "img-src" },
        [],
      ),
    ).toEqual([]);
    expect(reportedSites(report, ["dog.ceo"])).toEqual(["dog.ceo"]);
    const full = Array.from({ length: MAX_PAGE_SITES }, (_, index) => `site${index}.example`);
    expect(reportedSites(report, full)).toBe(full);
  });

  it("does not reveal which grown-ups were notified while the child is waiting", () => {
    expect(pageAskWaitingCopy()).toBe(
      "We've let your grown-ups know. The parent code stays on this device while they decide.",
    );
    expect(pageAskWaitingCopy()).not.toContain("Mum");
  });

  it("keeps a fixed keydown and keyup script pair for every game key", () => {
    expect(Object.keys(GAME_KEY_SCRIPTS)).toEqual([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      " ",
    ]);
    for (const [key, scripts] of Object.entries(GAME_KEY_SCRIPTS)) {
      expect(scripts.pressIn).toContain("keydown");
      expect(scripts.pressOut).toContain("keyup");
      expect(scripts.pressIn).toContain("document.dispatchEvent(e);window.dispatchEvent(e)");
      expect(scripts.pressOut).toContain("document.dispatchEvent(e);window.dispatchEvent(e)");
      expect(scripts.pressIn).toContain(key === " " ? "Space" : key);
      expect(scripts.pressOut).toContain(key === " " ? "Space" : key);
    }
  });

  it("starts game buttons off for each page", () => {
    expect(GAME_BUTTONS_DEFAULT).toBe(false);
    expect(gameButtonsForPage("test:page-preview:default-off")).toBe(false);
  });
});
