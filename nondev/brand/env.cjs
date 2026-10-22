"use strict";
/**
 * Brand bootstrap for the nondev fork.
 *
 * Reads `nondev/brand.json` and sets `T3CODE_*` environment DEFAULTS before any upstream module
 * evaluates. Every upstream seam is a one-liner of the form `process.env.X ?? upstreamDefault`,
 * so upstream's own defaults stay intact (the seams are upstreamable) and this file is the only
 * place that knows the fork's identity.
 *
 * Loaded from three places:
 *   1. apps/desktop/src/boot.ts   -> bundled into dist-electron/boot.cjs, runs before main.cjs.
 *      The desktop then spawns the server with `extendEnv: true`, so the server inherits it.
 *   2. node --import ./nondev/brand/env.cjs scripts/build-desktop-artifact.ts ...
 *      (electron-builder appId / artifact name / protocol schemes / update feed, or none).
 *   3. node --import ./nondev/brand/env.cjs apps/server/dist/bin.mjs   (standalone CLI).
 *
 * Plain CommonJS on purpose: it must run before Effect, before the bundler-defined globals, and
 * from a `require()` in boot.ts. Values already present in the environment always win (`??=`).
 */
const NodeOS = require("node:os");
const NodePath = require("node:path");
const brand = require("../brand.json");

/** The TCP discard port on loopback: a connection is refused immediately and nothing leaves the machine. */
const LOCAL_SINK_HOST = "http://127.0.0.1:9";

/**
 * @param {typeof brand} b
 * @param {{ homedir: string }} host
 * @returns {Record<string, string>} the T3CODE_* defaults for this brand, in a stable order.
 */
function resolveBrandEnv(b, host) {
  const entryDir = NodePath.posix.dirname(b.defaultClientEntry);
  const clientEntryPath = entryDir === "." ? "/" : `/${entryDir}/`;
  const telemetryKey = b.telemetry && b.telemetry.posthogKey;
  const telemetryHost = b.telemetry && b.telemetry.posthogHost;
  return {
    // State directory for desktop + embedded server + CLI (upstream default ~/.t3). Keeps the fork
    // off the operator's live T3 Code database. Already env-driven upstream: no seam needed.
    T3CODE_HOME: NodePath.join(host.homedir, b.homeDirName),
    // Display name used in menus, window title, about panel (seam: brand-app-name).
    T3CODE_APP_BASE_NAME: b.productName,
    // Renderer + deep-link scheme; dev builds use `${scheme}-dev` (seams: brand-scheme*).
    T3CODE_DESKTOP_SCHEME: b.protocolScheme,
    // macOS bundle id / Windows AppUserModelID (seam: brand-app-id; AppUserModelID already env-driven).
    T3CODE_DESKTOP_APP_ID: b.appId,
    T3CODE_DESKTOP_APP_USER_MODEL_ID: b.appId,
    // Chromium profile directory under the OS app-data dir (seam: brand-userdata).
    T3CODE_DESKTOP_USER_DATA_DIR: b.userDataDirName,
    // What the desktop window loads under `${scheme}://app/` (seam: brand-client-entry).
    T3CODE_DESKTOP_CLIENT_ENTRY: b.defaultClientEntry,
    // Path the server puts in printed/opened pairing URLs (seam: brand-client-entry, server side).
    T3CODE_CLIENT_ENTRY: clientEntryPath,
    // The app's update feed: brand.json `updates.feed`, "none" for none (not "": empty reads as unset). The ONLY feed a SKYCOT build
    // bakes in or an installed app accepts; T3 Code's releases are refused even if named here
    // (seams skycot-update-feed*, packages/skycot-brand/src/updateFeed.ts).
    T3CODE_SKYCOT_UPDATE_FEED: (b.updates && b.updates.feed) || "none",
    // Source repository for Advanced mode's release links (apps/web vite define). Upstream's build
    // also reads it as a feed, but a branded build takes T3CODE_SKYCOT_UPDATE_FEED instead.
    T3CODE_DESKTOP_UPDATE_REPOSITORY: b.updateRepository,
    // `skycot update` release feed (seam: brand-cli-update-repo); same repository as the desktop feed.
    T3CODE_CLI_UPDATE_REPOSITORY: b.updateRepository,
    // electron-builder artifact file name (seam: brand-artifact-name). `${...}` are electron-builder macros.
    T3CODE_DESKTOP_ARTIFACT_NAME: `${b.artifactPrefix}-\${version}-\${arch}.\${ext}`,
    // Installed app icon, always the DAY drawing (brand guide: Finder / Start menu never switch;
    // only the running Dock tile follows the sky). Repo-relative; read by the desktop build only
    // (seam: brand-desktop-icons). The .icns carries the hand-drawn 16-63 px versions.
    T3CODE_DESKTOP_ICON_MAC_PNG:
      "nondev/brand/assets/macos/AppIcon-day.iconset/icon_512x512@2x.png",
    T3CODE_DESKTOP_ICON_MAC_ICNS: "nondev/brand/assets/macos/AppIcon-day.icns",
    T3CODE_DESKTOP_ICON_LINUX_PNG: "nondev/brand/assets/linux/app-icon-day-512.png",
    T3CODE_DESKTOP_ICON_WIN_ICO: "nondev/brand/assets/windows/app-icon-day.ico",
    // Analytics: off by default, and never upstream's PostHog project (already env-driven upstream).
    T3CODE_TELEMETRY_ENABLED: b.telemetryEnabledByDefault ? "true" : "false",
    T3CODE_POSTHOG_KEY: telemetryKey || "",
    T3CODE_POSTHOG_HOST: telemetryHost || LOCAL_SINK_HOST,
    // Safety (SEC-03): the engine's own default runtime mode is full-access upstream; SKYCOT
    // starts every thread that inherits the default in "Ask me first" (seam: skycot-default-runtime-mode).
    T3CODE_DEFAULT_RUNTIME_MODE: "approval-required",
    // Safety (SEC-01): server-side hard rules for "Just do it, carefully" (seams: skycot-policy-*).
    T3CODE_SKYCOT_POLICY: "1",
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {Record<string, string>} defaults
 * @returns {string[]} names that were set (absent before).
 */
function applyBrandEnvDefaults(env, defaults) {
  const applied = [];
  for (const [name, value] of Object.entries(defaults)) {
    if (env[name] === undefined) {
      env[name] = value;
      applied.push(name);
    }
  }
  return applied;
}

if (process.env.T3CODE_BRAND_ENV_SKIP !== "1") {
  applyBrandEnvDefaults(process.env, resolveBrandEnv(brand, { homedir: NodeOS.homedir() }));
}

module.exports = { brand, resolveBrandEnv, applyBrandEnvDefaults, LOCAL_SINK_HOST };
