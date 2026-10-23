// A hash router of about forty lines instead of TanStack's file-based router.
// The server's SPA fallback and the desktop's asset handler both serve the
// stock index.html for unknown paths under /simple/, so every route must live
// in the fragment; file-based route generation in a sibling package would
// also mean a second routeTree.gen.ts and plugin config for three screens.
import { getPairingTokenFromUrl } from "@t3tools/shared/remote";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export type Route =
  | { readonly name: "home" }
  /** The compose screen on a phone-width layout; identical to home elsewhere. */
  | { readonly name: "new" }
  | { readonly name: "pair" }
  | { readonly name: "thread"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  /**
   * A project's files, Finder-style. With a conversation, its private copy (what that
   * conversation changed); without, the project's own folder.
   */
  | {
      readonly name: "files";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly threadId: ThreadId | null;
    }
  | { readonly name: "automations" }
  | { readonly name: "people" }
  /** The family fridge: everything the children made. */
  | { readonly name: "fridge" }
  /** This child's sticker book. */
  | { readonly name: "stickers" }
  /** A printable certificate from the sticker book. */
  | { readonly name: "certificate"; readonly kind: "first" | "tenth" }
  /** Settings › Family › "<child>'s week". */
  | { readonly name: "recap"; readonly childId: string }
  /** System Settings-style screen; `section` is null for the list on a phone. */
  | { readonly name: "settings"; readonly section: SettingsSection | null }
  /** First-run onboarding, re-enterable from Settings. */
  | { readonly name: "welcome" }
  | { readonly name: "not-found"; readonly path: string };

export const SETTINGS_SECTIONS = [
  "assistants",
  "autonomy",
  "notifications",
  "family",
  "sharing",
  "mac",
  "appearance",
  "voice",
  "privacy",
  "advanced",
  "about",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as ReadonlyArray<string>).includes(value);
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // Pairing links put the token in the fragment (`#token=…`), which is also
  // where our routes live; a fragment carrying a token is the pairing screen.
  if (!raw.startsWith("/")) {
    if (raw === "") return { name: "home" };
    if (getPairingTokenFromUrl(new URL(`http://x/#${raw}`)) !== null) return { name: "pair" };
    return { name: "not-found", path: raw };
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { name: "home" };
  if (segments.length === 1) {
    switch (segments[0]) {
      case "pair":
        return { name: "pair" };
      case "new":
        return { name: "new" };
      case "automations":
        return { name: "automations" };
      case "people":
        return { name: "people" };
      case "fridge":
        return { name: "fridge" };
      case "stickers":
        return { name: "stickers" };
      case "settings":
        return { name: "settings", section: null };
      case "welcome":
        return { name: "welcome" };
      default:
        break;
    }
  }
  if (segments[0] === "settings" && segments.length === 2 && isSettingsSection(segments[1]!)) {
    return { name: "settings", section: segments[1] };
  }
  if (
    segments[0] === "settings" &&
    segments[1] === "family" &&
    segments[2] === "week" &&
    segments.length === 4
  ) {
    return { name: "recap", childId: decodeURIComponent(segments[3]!) };
  }
  if (
    segments[0] === "stickers" &&
    segments[1] === "certificate" &&
    segments.length === 3 &&
    (segments[2] === "first" || segments[2] === "tenth")
  ) {
    return { name: "certificate", kind: segments[2] };
  }
  if (segments[0] === "files" && (segments.length === 3 || segments.length === 4)) {
    return {
      name: "files",
      environmentId: decodeURIComponent(segments[1]!) as EnvironmentId,
      projectId: decodeURIComponent(segments[2]!) as ProjectId,
      threadId: segments[3] === undefined ? null : (decodeURIComponent(segments[3]) as ThreadId),
    };
  }
  if (segments[0] === "thread" && segments.length === 3) {
    return {
      name: "thread",
      environmentId: decodeURIComponent(segments[1]!) as EnvironmentId,
      threadId: decodeURIComponent(segments[2]!) as ThreadId,
    };
  }
  return { name: "not-found", path: raw };
}

export const HOME_HREF = "#/";
export const NEW_HREF = "#/new";
export const AUTOMATIONS_HREF = "#/automations";
export const PEOPLE_HREF = "#/people";
export const FRIDGE_HREF = "#/fridge";
export const STICKERS_HREF = "#/stickers";
export const SETTINGS_HREF = "#/settings";
export const WELCOME_HREF = "#/welcome";

export function settingsHref(section: SettingsSection): string {
  return `#/settings/${section}`;
}

export function recapHref(childId: string): string {
  return `#/settings/family/week/${encodeURIComponent(childId)}`;
}

export function certificateHref(kind: "first" | "tenth"): string {
  return `#/stickers/certificate/${kind}`;
}

export function threadHref(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `#/thread/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

export function filesHref(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  threadId: ThreadId | null = null,
): string {
  const base = `#/files/${encodeURIComponent(environmentId)}/${encodeURIComponent(projectId)}`;
  return threadId === null ? base : `${base}/${encodeURIComponent(threadId)}`;
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(href: string): void {
  window.location.hash = href.startsWith("#") ? href.slice(1) : href;
}
