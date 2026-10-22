import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NO_FEED_HEADLINE,
  browserUpdateView,
  desktopUpdateView,
  parseEngineUpdates,
  plainReleaseNotes,
  readyVersion,
  runningWarning,
} from "./updates";

const NOW = new Date("2026-10-23T10:00:00");

const base: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "0.0.42",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
const state = (patch: Partial<DesktopUpdateState>): DesktopUpdateState => ({ ...base, ...patch });

describe("Settings → About, in the Mac app", () => {
  it("is honest while SKYCOT has no update feed", () => {
    const view = desktopUpdateView(
      state({
        enabled: false,
        status: "disabled",
        message: "Automatic updates are not available because no update feed is configured.",
      }),
      NOW,
    );
    expect(view.headline).toBe(NO_FEED_HEADLINE);
    expect(view.action).toBeNull();
  });

  it("says a test copy does not update itself", () => {
    const view = desktopUpdateView(
      state({
        enabled: false,
        status: "disabled",
        message: "Automatic updates are only available in packaged production builds.",
      }),
      NOW,
    );
    expect(view.detail).toContain("test copy");
  });

  it("walks through checking, up to date, downloading and ready", () => {
    expect(desktopUpdateView(state({ status: "checking" }), NOW).headline).toBe(
      "Looking for a new version…",
    );
    const upToDate = desktopUpdateView(
      state({ status: "up-to-date", checkedAt: "2026-10-23T09:41:00" }),
      NOW,
    );
    expect(upToDate.headline).toBe("You're up to date.");
    expect(upToDate.detail).toMatch(/^Checked today at/u);
    expect(upToDate.action).toBe("check");

    const downloading = desktopUpdateView(
      state({ status: "downloading", availableVersion: "0.0.43", downloadPercent: 41.7 }),
      NOW,
    );
    expect(downloading.headline).toBe("Downloading…");
    expect(downloading.progress).toBe(41);

    const ready = desktopUpdateView(
      state({ status: "downloaded", availableVersion: "0.0.43", downloadedVersion: "0.0.43" }),
      NOW,
    );
    expect(ready.headline).toBe("A new version is ready.");
    expect(ready.action).toBe("restart");
  });

  it("offers the restart again after a failed install, and a retry after a failed download", () => {
    const failedInstall = state({
      status: "error",
      errorContext: "install",
      downloadedVersion: "0.0.43",
    });
    expect(readyVersion(failedInstall)).toBe("0.0.43");
    expect(desktopUpdateView(failedInstall, NOW).action).toBe("restart");
    const failedDownload = state({ status: "error", errorContext: "download" });
    expect(readyVersion(failedDownload)).toBeNull();
    expect(desktopUpdateView(failedDownload, NOW).action).toBe("retry-download");
  });
});

describe("Settings → About, in a browser", () => {
  const engine = (patch: Record<string, unknown>) =>
    parseEngineUpdates({
      version: "0.0.42",
      desktop: false,
      feed: "none",
      latestVersion: null,
      newer: false,
      ...patch,
    });

  it("shows the version only when the engine cannot know about updates", () => {
    expect(browserUpdateView(engine({}))).toBeNull();
    expect(browserUpdateView(null)).toBeNull();
  });

  it("says a newer SKYCOT exists, and how to get it", () => {
    const view = browserUpdateView(
      engine({ feed: "configured", latestVersion: "0.0.43", newer: true }),
    );
    expect(view?.headline).toBe("SKYCOT 0.0.43 is out.");
    expect(view?.detail).toContain("skycot.com");
  });

  it("points a browser of the Mac app's engine at the Mac", () => {
    expect(browserUpdateView(engine({ desktop: true }))?.headline).toContain("on the Mac");
  });

  it("rejects an answer that is not the engine's", () => {
    expect(parseEngineUpdates({ version: 1 })).toBeNull();
    expect(parseEngineUpdates("nope")).toBeNull();
  });
});

describe("the restart sheet", () => {
  it("keeps plain release notes and drops developer changelog lines", () => {
    const notes = plainReleaseNotes(
      state({
        releaseNotes: [
          {
            version: "0.0.43",
            items: [
              "Bedtime now shows a calm countdown.",
              "fix(server): drain the effect worker (#22904)",
              "Full changelog: https://github.com/mark-hallam/skycot-product/compare/a...b",
              "The fridge shows bigger pictures.",
            ],
            totalItems: 4,
          },
        ],
      }),
      "0.0.43",
    );
    expect(notes).toEqual([
      "Bedtime now shows a calm countdown.",
      "The fridge shows bigger pictures.",
    ]);
  });

  it("warns, by the crew's name, when a conversation is still running", () => {
    expect(runningWarning(0, "Sam")).toBeNull();
    expect(runningWarning(1, "Sam")).toBe(
      "Sam is still working on 1 conversation. Restarting pauses it; it carries on by itself when SKYCOT opens again.",
    );
    expect(runningWarning(2, "Sam")).toContain("2 conversations");
  });
});
