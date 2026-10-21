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
 *      (electron-builder appId / artifact name / protocol schemes / update feed).
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
    // electron-updater feed; never upstream's binaries (already env-driven upstream).
    T3CODE_DESKTOP_UPDATE_REPOSITORY: b.updateRepository,
    // electron-builder artifact file name (seam: brand-artifact-name). `${...}` are electron-builder macros.
    T3CODE_DESKTOP_ARTIFACT_NAME: `${b.artifactPrefix}-\${version}-\${arch}.\${ext}`,
    // Analytics: off by default, and never upstream's PostHog project (already env-driven upstream).
    T3CODE_TELEMETRY_ENABLED: b.telemetryEnabledByDefault ? "true" : "false",
    T3CODE_POSTHOG_KEY: telemetryKey || "",
    T3CODE_POSTHOG_HOST: telemetryHost || LOCAL_SINK_HOST,
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
