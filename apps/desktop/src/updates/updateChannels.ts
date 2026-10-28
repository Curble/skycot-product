import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /^[^-+]+-nightly\.\d{8}\.\d+$/;
// They share nightly's branding but are packaged without an update feed (see
// isDesktopPreviewVersion in scripts/build-desktop-artifact.ts), so the channel
// a preview install reports is cosmetic: it never checks for updates and no
// updater feed ever lists a preview release.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

// nondev-seam: skycot-update-staging-match
/**
 * Whether a version the feed offers belongs to the selected channel. Staging takes whatever its own
 * `staging-mac.yml` lists (that file is the gate); the other channels also match by version shape.
 */
export function updateMatchesChannel(channel: DesktopUpdateChannel, version: string): boolean {
  return channel === "staging" || resolveDefaultDesktopUpdateChannel(version) === channel;
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return NIGHTLY_VERSION_PATTERN.test(appVersion) ? "nightly" : "latest";
}
