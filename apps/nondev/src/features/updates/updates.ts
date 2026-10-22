// SKYCOT's own updates, in plain words. Pure: the desktop app's updater state (the Mac app) and
// the engine's answer (`/api/skycot/updates`, for a browser) go in; what About and the title-bar
// pill say comes out. Where the updates come from, and why never from T3 Code, is in
// packages/skycot-brand/src/updateFeed.ts; the Family rule for restarting is in updateRestart.ts.
import type { DesktopUpdateState } from "@t3tools/contracts";

/** `GET /api/skycot/updates`, as the engine sends it. */
export interface EngineUpdates {
  readonly version: string;
  /** The engine was started by the Mac app, which updates both. */
  readonly desktop: boolean;
  readonly feed: "none" | "configured" | "refused";
  readonly latestVersion: string | null;
  readonly newer: boolean;
}

export function parseEngineUpdates(body: unknown): EngineUpdates | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const feed = record["feed"];
  if (
    typeof record["version"] !== "string" ||
    typeof record["desktop"] !== "boolean" ||
    (feed !== "none" && feed !== "configured" && feed !== "refused")
  ) {
    return null;
  }
  return {
    version: record["version"],
    desktop: record["desktop"],
    feed,
    latestVersion: typeof record["latestVersion"] === "string" ? record["latestVersion"] : null,
    newer: record["newer"] === true,
  };
}

export type UpdateAction = "check" | "retry-download" | "restart";

export interface UpdateView {
  readonly headline: string;
  readonly detail: string | null;
  readonly tone: "quiet" | "ok" | "busy" | "ready" | "warn";
  /** 0–100 while downloading. */
  readonly progress: number | null;
  readonly action: UpdateAction | null;
}

export const NO_FEED_HEADLINE = "Updates will arrive here once SKYCOT's Mac download opens.";

/** "today at 9:41", "yesterday", "on 21 Oct": when SKYCOT last looked. */
export function checkedWhen(checkedAt: string | null, now: Date): string | null {
  if (checkedAt === null) return null;
  const at = new Date(checkedAt);
  if (Number.isNaN(at.getTime())) return null;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) {
    return `today at ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  if (days === 1) return "yesterday";
  return `on ${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** The downloaded version a restart would put in place, if there is one. */
export function readyVersion(state: DesktopUpdateState | null): string | null {
  if (state === null || state.downloadedVersion === null) return null;
  const installable =
    state.status === "downloaded" ||
    (state.status === "error" && (state.errorContext === null || state.errorContext === "install"));
  return installable ? state.downloadedVersion : null;
}

/** What the Mac app's updater state means, for Settings → About. */
export function desktopUpdateView(state: DesktopUpdateState, now: Date): UpdateView {
  if (!state.enabled || state.status === "disabled") {
    const message = state.message ?? "";
    if (/no update feed/iu.test(message) || message === "") {
      return {
        headline: NO_FEED_HEADLINE,
        detail: null,
        tone: "quiet",
        progress: null,
        action: null,
      };
    }
    const detail = /packaged production/iu.test(message)
      ? "This is a test copy of SKYCOT, so it doesn't update itself."
      : /DISABLE_AUTO_UPDATE/u.test(message)
        ? "Automatic updates are switched off on this Mac."
        : "This copy of SKYCOT doesn't update itself.";
    return { headline: "Updates are off.", detail, tone: "quiet", progress: null, action: null };
  }
  const ready = readyVersion(state);
  const when = checkedWhen(state.checkedAt, now);
  switch (state.status) {
    case "checking":
      return {
        headline: "Looking for a new version…",
        detail: null,
        tone: "busy",
        progress: null,
        action: null,
      };
    case "up-to-date":
      return {
        headline: "You're up to date.",
        detail: when ? `Checked ${when}.` : null,
        tone: "ok",
        progress: null,
        action: "check",
      };
    case "available":
      return {
        headline: `Version ${state.availableVersion ?? "new"} is on its way.`,
        detail: "Getting it ready in the background.",
        tone: "busy",
        progress: 0,
        action: null,
      };
    case "downloading":
      return {
        headline: "Downloading…",
        detail: `${state.availableVersion ? `Version ${state.availableVersion} · ` : ""}${Math.max(0, Math.min(100, Math.floor(state.downloadPercent ?? 0)))}%`,
        tone: "busy",
        progress: Math.max(0, Math.min(100, Math.floor(state.downloadPercent ?? 0))),
        action: null,
      };
    case "downloaded":
      return {
        headline: "A new version is ready.",
        detail: `Version ${ready ?? state.downloadedVersion}. Restart SKYCOT to start using it.`,
        tone: "ready",
        progress: null,
        action: "restart",
      };
    case "error":
      if (ready !== null) {
        return {
          headline: "The new version didn't go in.",
          detail: `SKYCOT is still on version ${state.currentVersion}. Try the restart again.`,
          tone: "warn",
          progress: null,
          action: "restart",
        };
      }
      if (state.errorContext === "download") {
        return {
          headline: "The download stopped part-way.",
          detail: "Check the internet connection, then try again.",
          tone: "warn",
          progress: null,
          action: "retry-download",
        };
      }
      return {
        headline: "Couldn't look for updates just now.",
        detail: "SKYCOT tries again by itself every few minutes.",
        tone: "warn",
        progress: null,
        action: "check",
      };
    case "idle":
      return {
        headline: "SKYCOT looks for new versions by itself.",
        detail: when ? `Last checked ${when}.` : null,
        tone: "quiet",
        progress: null,
        action: "check",
      };
  }
}

/**
 * For a browser (no Mac app around this page): only what the engine can honestly know. Null
 * means About shows the version and nothing else.
 */
export function browserUpdateView(engine: EngineUpdates | null): UpdateView | null {
  if (engine === null) return null;
  if (engine.newer && engine.latestVersion !== null) {
    return {
      headline: `SKYCOT ${engine.latestVersion} is out.`,
      detail: engine.desktop
        ? "Open SKYCOT on the Mac it runs on: the new version is ready to install there."
        : "To update, download the new version from skycot.com and open it.",
      tone: "ready",
      progress: null,
      action: null,
    };
  }
  if (engine.desktop) {
    return {
      headline: "New versions arrive in the SKYCOT app on the Mac.",
      detail: null,
      tone: "quiet",
      progress: null,
      action: null,
    };
  }
  return null;
}

/**
 * The plain release notes for the version a restart puts in place: SKYCOT writes them in plain
 * words; anything that looks like a developer changelog line (a link, a commit, a pull request
 * number) is left out rather than shown to a child.
 */
export function plainReleaseNotes(
  state: DesktopUpdateState,
  version: string,
): ReadonlyArray<string> {
  const group =
    state.releaseNotes.find((note) => note.version === version) ?? state.releaseNotes[0];
  if (!group) return [];
  return group.items
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length > 0 &&
        !/https?:\/\/|#\d{2,}|\b[0-9a-f]{7,40}\b|^(feat|fix|chore|refactor|docs|ci|build)(\(|:)/iu.test(
          item,
        ),
    )
    .slice(0, 6);
}

/** "Sam is still working on 2 conversations." for the restart warning; null when nothing runs. */
export function runningWarning(running: number, builderName: string): string | null {
  if (running <= 0) return null;
  return `${builderName} is still working on ${running === 1 ? "1 conversation" : `${running} conversations`}. Restarting pauses it; it carries on by itself when SKYCOT opens again.`;
}
