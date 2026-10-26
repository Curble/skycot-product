// nondev-seam: skycot-mobile-page-logic-test
// nondev-seam: skycot-iphone-q39-page-copy-test
import { describe, expect, it } from "vite-plus/test";
import { MAX_PAGE_SITES } from "@t3tools/skycot-rules/page-internet";

import {
  allowsPlayNavigation,
  diagnosticReport,
  diagnosticSheetCopy,
  EMPTY_PAGE_DIAGNOSTICS,
  GAME_BUTTONS_DEFAULT,
  GAME_KEY_SCRIPTS,
  gameButtonsForPage,
  pageHasOwnGameControls,
  pageLooksWrong,
  pageToolbarCopy,
  playableCopy,
  parsePageDiagnostic,
  playNoticeCopy,
  pageAskWaitingCopy,
  reportedSites,
} from "./pagePreviewLogic";

describe("the sealed page viewer", () => {
  it("uses the playable copy only when the engine returned HTML", () => {
    const playable = {
      html: "<script>game()</script>",
      reason: null,
      needs: { scripts: [], other: [] },
      page: "/a/game.html",
    } as const;
    expect(playableCopy({ ok: true, value: playable })).toBe(playable);
    expect(
      playableCopy({
        ok: true,
        value: {
          html: null,
          reason: "too-big",
          needs: { scripts: [], other: [] },
          page: "/a/game.html",
        },
      }),
    ).toBeNull();
    expect(playableCopy({ ok: false })).toBeNull();
  });

  it("explains why a game cannot play in child and grown-up words", () => {
    const childUpdate = playNoticeCopy("engine-update", true);
    expect(childUpdate.title).toBe("This game can't play here yet");
    expect(childUpdate.message).toContain("You're seeing a picture of the game.");
    expect(childUpdate.message).toContain("Ask a grown-up to update it.");
    expect(childUpdate.grownUp).toBeNull();
    const adultUpdate = playNoticeCopy("engine-update", false);
    expect(adultUpdate.grownUp).toBe("Update SKYCOT on the Mac (Settings > About).");

    const remote = playNoticeCopy("remote-script", true, ["example.com"], "iPad");
    expect(remote.message).toContain("tool from the internet (example.com)");
    expect(remote.message).toContain("It works on the Mac.");
    expect(remote.tellSam).toBe(
      "Please make my game work without loading anything from the internet, so it plays on this iPad.",
    );
    const phoneRemote = playNoticeCopy("remote-script", true, ["example.com"], "iPhone");
    expect(phoneRemote.message).toContain("can't run on this iPhone");
    expect(phoneRemote.tellSam).toContain("plays on this iPhone");
    expect(remote.tellSamLabel).toBe("Tell Sam");
    expect(playNoticeCopy("too-big", true).message).toContain("too big to play on this iPad");
    expect(playNoticeCopy("unpackable-module", true).message).toContain(
      "part of this game is missing",
    );
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

  it("parses bounded diagnostics, identifies a stalled or broken page, and keeps reports private", () => {
    let diagnostics = parsePageDiagnostic(
      {
        skycot: "diag",
        facts: { ios: "17_7_11", safari: "17.6", frames: 0, blank: true, packedBytes: 9200 },
        entries: [{ kind: "error", text: "Can't find variable: score (game.js line 42)" }],
      },
      EMPTY_PAGE_DIAGNOSTICS,
    );
    diagnostics = parsePageDiagnostic(
      {
        skycot: "diag",
        entries: Array.from({ length: 40 }, (_, index) => ({
          kind: "warn",
          text: `warning ${index}`,
        })),
      },
      diagnostics,
    );
    expect(diagnostics.entries).toHaveLength(30);
    expect(pageLooksWrong(EMPTY_PAGE_DIAGNOSTICS, 2999)).toBe(false);
    expect(pageLooksWrong(EMPTY_PAGE_DIAGNOSTICS, 3000)).toBe(true);
    expect(
      pageLooksWrong(
        parsePageDiagnostic(
          { skycot: "diag", entries: [{ kind: "warn", text: "FYI" }] },
          EMPTY_PAGE_DIAGNOSTICS,
        ),
        0,
      ),
    ).toBe(false);
    expect(pageLooksWrong(diagnostics, 0)).toBe(true);
    const moving = parsePageDiagnostic(
      {
        skycot: "diag",
        facts: { frames: 120 },
        entries: [{ kind: "error", text: "Script error" }],
      },
      EMPTY_PAGE_DIAGNOSTICS,
    );
    expect(pageLooksWrong(moving, 3000)).toBe(false);
    const movingCopy = diagnosticSheetCopy(moving, true, undefined, "iPhone");
    expect(movingCopy.headline).toBe("Is something not working?");
    expect(movingCopy.lines.join(" ")).toContain("game is running");
    expect(movingCopy.lines.join(" ")).not.toMatch(/did not start|Script error|code stopped/iu);

    const childCopy = diagnosticSheetCopy(diagnostics, true);
    expect(childCopy.headline).toBe("This game hit a problem on this iPad");
    expect(childCopy.lines.length).toBeGreaterThanOrEqual(3);
    expect(childCopy.lines.length).toBeLessThanOrEqual(6);
    expect(childCopy.lines.join(" ")).not.toMatch(/stack|https?:|\/Users\//iu);
    expect(childCopy.lines.some((line) => line.includes("iPadOS 17.7.11"))).toBe(true);
    const phoneCopy = diagnosticSheetCopy(diagnostics, true, undefined, "iPhone");
    expect(phoneCopy.headline).toContain("iPhone");
    expect(phoneCopy.lines.join(" ")).not.toContain("Script error");
    const policyCopy = diagnosticSheetCopy(
      parsePageDiagnostic(
        { skycot: "diag", entries: [{ kind: "policy", text: "script-src blocked games.example" }] },
        EMPTY_PAGE_DIAGNOSTICS,
      ),
      true,
    );
    expect(policyCopy.lines.join(" ")).toContain("stopped the game from using games.example");
    expect(policyCopy.lines.join(" ")).not.toContain("script-src");
    const report = diagnosticReport(
      diagnostics,
      {
        reason: "unpackable-module",
        needs: { scripts: ["https://private.example/a.js?token=secret"], other: [] },
        packedBytes: 9200,
        embeddedFiles: 2,
        modulesBundled: false,
        missingFiles: ["images/cat.png"],
      },
      "7",
      "playable",
    );
    expect(report).toContain("cat.png");
    expect(report).not.toContain("private.example");
    expect(report).not.toContain("token=secret");
    expect(report).not.toContain("/Users/");
    expect(report.length).toBeLessThanOrEqual(4000);
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
    expect(gameButtonsForPage("test:page-preview:own-controls", true)).toBe(false);
  });

  it("recognizes labelled game controls and keeps viewer actions clear", () => {
    expect(
      pageHasOwnGameControls('<button aria-label="Move left">←</button><button>KICK</button>'),
    ).toBe(true);
    expect(pageHasOwnGameControls("<button>Open settings</button>")).toBe(false);
    expect(pageToolbarCopy(true, false)).toEqual({
      done: "Done",
      fullScreen: "Full screen",
      extraButtons: "Extra buttons",
    });
    expect(pageToolbarCopy(false, true)).toEqual({
      done: "Back",
      fullScreen: "Exit full screen",
      extraButtons: "Extra buttons",
    });
  });
});
