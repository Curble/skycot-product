#!/usr/bin/env node
/**
 * apply-brand — the brand's checker and explainer. It never rewrites upstream files.
 *
 *   node nondev/scripts/apply-brand.ts            validate + print what the brand changes
 *   node nondev/scripts/apply-brand.ts --env      print `NAME=VALUE` lines (eval / CI)
 *   node nondev/scripts/apply-brand.ts --github-env   append those lines to $GITHUB_ENV
 *   node nondev/scripts/apply-brand.ts --quiet    only errors
 *
 * Why it does not write: upstream files are merged from pingdotgg/t3code every night. Each brand
 * seam in them is a one-liner `process.env.X ?? upstreamDefault` with a `// nondev-seam: <id>`
 * marker, and `nondev/brand/env.cjs` supplies X at process start from `nondev/brand.json`. The
 * only hand-edited value is `productName` in apps/desktop/package.json (JSON cannot read env).
 * This script checks that every seam is still intact and shows the effective values side by side.
 *
 * Exit codes: 0 ok, 1 validation failed (details on stderr).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { updateFeedProblems } from "./update-feed-guard.ts";

const require = NodeModule.createRequire(import.meta.url);
const ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");

interface Brand {
  readonly productName: string;
  readonly appId: string;
  readonly protocolScheme: string;
  readonly homeDirName: string;
  readonly userDataDirName: string;
  readonly cliName: string;
  readonly artifactPrefix: string;
  readonly defaultClientEntry: string;
  readonly updateRepository: string;
  readonly telemetryEnabledByDefault: boolean;
  readonly telemetry?: { readonly posthogKey: string | null; readonly posthogHost: string | null };
  readonly upstreamCredit: string;
}

interface BrandEnvModule {
  readonly brand: Brand;
  readonly resolveBrandEnv: (brand: Brand, host: { homedir: string }) => Record<string, string>;
}

/** One place where an upstream constant is read through the environment. */
interface Seam {
  readonly id: string;
  readonly file: string;
  /** What the operator sees: the constant this seam controls. */
  readonly constant: string;
  readonly envName: string;
  /** Upstream's literal default, which must still be present on the seam line (keeps it upstreamable). */
  readonly upstreamDefault: string;
  /** Effective value for this brand (derived from the env record). */
  readonly effective: (env: Record<string, string>) => string;
  readonly mechanism: "env seam" | "upstream env (no edit)" | "hard edit (JSON)" | "hard edit (TS)";
}

const UPSTREAM_PRODUCT_NAME = "T3 Code (Beta)";
const UPSTREAM_CLERK_KEY = "pk_live_Y2xlcmsudDMuY29kZXMk";
const UPSTREAM_RELAY_HOST = "relay.t3.codes";

const quiet = process.argv.includes("--quiet");
const printEnv = process.argv.includes("--env");
const githubEnv = process.argv.includes("--github-env");

function read(relativePath: string): string | undefined {
  const absolute = NodePath.join(ROOT, relativePath);
  return NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : undefined;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function validateBrand(brand: Brand): string[] {
  const errors: string[] = [];
  const nonEmpty = (name: keyof Brand) => {
    const value = brand[name];
    if (typeof value !== "string" || value.trim() === "")
      errors.push(`brand.json: ${name} must be a non-empty string`);
  };
  for (const name of [
    "productName",
    "appId",
    "protocolScheme",
    "homeDirName",
    "userDataDirName",
    "cliName",
    "artifactPrefix",
    "defaultClientEntry",
    "updateRepository",
    "upstreamCredit",
  ] as const) {
    nonEmpty(name);
  }
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/u.test(brand.appId))
    errors.push(
      `brand.json: appId "${brand.appId}" must be reverse-DNS, lowercase (e.g. com.example.app)`,
    );
  if (brand.appId.startsWith("com.t3tools."))
    errors.push("brand.json: appId must not be upstream's com.t3tools.*");
  if (!/^[a-z][a-z0-9+.-]*$/u.test(brand.protocolScheme))
    errors.push(`brand.json: protocolScheme "${brand.protocolScheme}" is not a valid URL scheme`);
  if (brand.protocolScheme === "t3code")
    errors.push(
      "brand.json: protocolScheme must differ from upstream's t3code, or deep links collide with an installed T3 Code",
    );
  if (!brand.homeDirName.startsWith(".") || brand.homeDirName === ".t3")
    errors.push(
      `brand.json: homeDirName "${brand.homeDirName}" must be a dot-directory other than .t3 (the operator's live T3 Code data)`,
    );
  if (/[\\/]/u.test(brand.homeDirName) || /[\\/]/u.test(brand.userDataDirName))
    errors.push("brand.json: homeDirName / userDataDirName must be single path segments");
  if (["t3code", "t3code-v2", "t3code-dev"].includes(brand.userDataDirName))
    errors.push("brand.json: userDataDirName must not reuse upstream's Chromium profile names");
  if (!/^[^/].*\/index\.html$/u.test(brand.defaultClientEntry))
    errors.push(
      `brand.json: defaultClientEntry "${brand.defaultClientEntry}" must be a relative path to an index.html (e.g. simple/index.html)`,
    );
  if (!/^[\w.-]+\/[\w.-]+$/u.test(brand.updateRepository))
    errors.push(`brand.json: updateRepository "${brand.updateRepository}" must be owner/repo`);
  if (brand.updateRepository.toLowerCase() === "pingdotgg/t3code")
    errors.push(
      "brand.json: updateRepository must never be upstream's, or users auto-update onto T3 Code binaries",
    );
  if (typeof brand.telemetryEnabledByDefault !== "boolean")
    errors.push("brand.json: telemetryEnabledByDefault must be true/false");
  if (!/^[A-Za-z][\w-]*$/u.test(brand.artifactPrefix))
    errors.push(
      `brand.json: artifactPrefix "${brand.artifactPrefix}" must be a plain file-name token`,
    );
  return errors;
}

function seams(): Seam[] {
  return [
    {
      id: "brand-boot",
      file: "apps/desktop/src/boot.ts",
      constant: "brand bootstrap (loads env.cjs before main)",
      envName: "nondev/brand/env.cjs",
      upstreamDefault: 'require("./main.cjs")',
      effective: () => "loaded before main.cjs",
      mechanism: "env seam",
    },
    {
      id: "brand-scheme",
      file: "apps/desktop/src/electron/ElectronProtocol.ts",
      constant: "renderer + deep-link scheme (prod / dev)",
      envName: "T3CODE_DESKTOP_SCHEME",
      upstreamDefault: '"t3code"',
      effective: (e) => `${e.T3CODE_DESKTOP_SCHEME}:// / ${e.T3CODE_DESKTOP_SCHEME}-dev://`,
      mechanism: "env seam",
    },
    {
      id: "brand-app-name",
      file: "apps/desktop/src/app/DesktopEnvironment.ts",
      constant: "APP_BASE_NAME (menus, window title, about panel)",
      envName: "T3CODE_APP_BASE_NAME",
      upstreamDefault: '"T3 Code"',
      effective: (e) => e.T3CODE_APP_BASE_NAME!,
      mechanism: "env seam",
    },
    {
      id: "brand-userdata",
      file: "apps/desktop/src/app/DesktopUserData.ts",
      constant: "Chromium profile dir (prod / dev)",
      envName: "T3CODE_DESKTOP_USER_DATA_DIR",
      upstreamDefault: '"t3code-v2"',
      effective: (e) => `${e.T3CODE_DESKTOP_USER_DATA_DIR} / ${e.T3CODE_DESKTOP_USER_DATA_DIR}-dev`,
      mechanism: "env seam",
    },
    {
      id: "brand-client-entry",
      file: "apps/desktop/src/window/DesktopWindow.ts",
      constant: "desktop renderer entry under <scheme>://app/",
      envName: "T3CODE_DESKTOP_CLIENT_ENTRY",
      upstreamDefault: '?? ""',
      effective: (e) => e.T3CODE_DESKTOP_CLIENT_ENTRY!,
      mechanism: "env seam",
    },
    {
      id: "brand-client-entry-pairing",
      file: "apps/server/src/auth/EnvironmentAuth.ts",
      constant: "startup pairing URL path (opened in the browser)",
      envName: "T3CODE_CLIENT_ENTRY",
      upstreamDefault: '"/pair"',
      effective: (e) => e.T3CODE_CLIENT_ENTRY!,
      mechanism: "env seam",
    },
    {
      id: "brand-client-entry-headless",
      file: "apps/server/src/startupAccess.ts",
      constant: "printed pairing URL path (headless / `pair` command)",
      envName: "T3CODE_CLIENT_ENTRY",
      upstreamDefault: '"/pair"',
      effective: (e) => e.T3CODE_CLIENT_ENTRY!,
      mechanism: "env seam",
    },
    {
      id: "brand-scheme-cors",
      file: "apps/server/src/httpCors.ts",
      constant: "DESKTOP_RENDERER_ORIGINS (server CORS allowlist)",
      envName: "T3CODE_DESKTOP_SCHEME",
      upstreamDefault: '"t3code"',
      effective: (e) => `${e.T3CODE_DESKTOP_SCHEME}://app, ${e.T3CODE_DESKTOP_SCHEME}-dev://app`,
      mechanism: "env seam",
    },
    {
      id: "brand-scheme-handoff",
      file: "packages/shared/src/codexAuthHandoff.ts",
      constant: "Codex sign-in hand-off deep link",
      envName: "T3CODE_DESKTOP_SCHEME",
      upstreamDefault: '"t3code"',
      effective: (e) => `${e.T3CODE_DESKTOP_SCHEME}://auth/codex`,
      mechanism: "env seam",
    },
    {
      id: "brand-scheme-return-url",
      file: "packages/shared/src/providerAuthReturnUrl.ts",
      constant: "accepted desktop return-URL protocols",
      envName: "T3CODE_DESKTOP_SCHEME",
      upstreamDefault: '"t3code"',
      effective: (e) => `${e.T3CODE_DESKTOP_SCHEME}:, ${e.T3CODE_DESKTOP_SCHEME}-dev:`,
      mechanism: "env seam",
    },
    {
      id: "brand-app-id",
      file: "scripts/build-desktop-artifact.ts",
      constant: "DESKTOP_APP_ID (macOS bundle id / installer id)",
      envName: "T3CODE_DESKTOP_APP_ID",
      upstreamDefault: '"com.t3tools.t3code"',
      effective: (e) => e.T3CODE_DESKTOP_APP_ID!,
      mechanism: "env seam",
    },
    {
      id: "brand-protocol-schemes",
      file: "scripts/build-desktop-artifact.ts",
      constant: "OS-registered URL schemes (Info.plist / Linux desktop entry)",
      envName: "T3CODE_DESKTOP_SCHEME",
      upstreamDefault: '"t3code"',
      effective: (e) => `${e.T3CODE_DESKTOP_SCHEME}, ${e.T3CODE_DESKTOP_SCHEME}-dev`,
      mechanism: "env seam",
    },
    {
      id: "brand-artifact-name",
      file: "scripts/build-desktop-artifact.ts",
      constant: "artifactName (installer file name)",
      envName: "T3CODE_DESKTOP_ARTIFACT_NAME",
      upstreamDefault: '"T3-Code-${version}-${arch}.${ext}"',
      effective: (e) => e.T3CODE_DESKTOP_ARTIFACT_NAME!,
      mechanism: "env seam",
    },
    {
      id: "brand-desktop-icons",
      file: "scripts/build-desktop-artifact.ts",
      constant: "installed macOS icon (.icns, hand-drawn small sizes)",
      envName: "T3CODE_DESKTOP_ICON_MAC_ICNS",
      upstreamDefault: "generateMacIconSet(sourcePng, iconIcnsPath, tmpRoot, path, verbose)",
      effective: (e) => e.T3CODE_DESKTOP_ICON_MAC_ICNS!,
      mechanism: "env seam",
    },
    {
      id: "brand-desktop-icons",
      file: "scripts/build-desktop-artifact.ts",
      constant: "installed macOS icon PNG (Resources/icon.png, DMG)",
      envName: "T3CODE_DESKTOP_ICON_MAC_PNG",
      upstreamDefault: "BRAND_ASSET_PATHS.productionMacIconPng",
      effective: (e) => e.T3CODE_DESKTOP_ICON_MAC_PNG!,
      mechanism: "env seam",
    },
    {
      id: "brand-desktop-icons",
      file: "scripts/build-desktop-artifact.ts",
      constant: "installed Linux icon set (resized from one PNG)",
      envName: "T3CODE_DESKTOP_ICON_LINUX_PNG",
      upstreamDefault: "BRAND_ASSET_PATHS.productionLinuxIconPng",
      effective: (e) => e.T3CODE_DESKTOP_ICON_LINUX_PNG!,
      mechanism: "env seam",
    },
    {
      id: "brand-desktop-icons",
      file: "scripts/build-desktop-artifact.ts",
      constant: "installed Windows icon (.ico)",
      envName: "T3CODE_DESKTOP_ICON_WIN_ICO",
      upstreamDefault: "BRAND_ASSET_PATHS.productionWindowsIconIco",
      effective: (e) => e.T3CODE_DESKTOP_ICON_WIN_ICO!,
      mechanism: "env seam",
    },
    {
      id: "brand-dock-icon",
      file: "apps/desktop/src/app/DesktopApp.ts",
      constant: "running Dock icon (day / dusk, follows local civil dusk and dawn)",
      envName: "../skycot/dockIcon.ts",
      upstreamDefault: "yield* appIdentity.configure;",
      effective: () => "apps/desktop/src/skycot/dockIcon.ts (macOS)",
      mechanism: "hard edit (TS)",
    },
    {
      id: "brand-cli-update-repo",
      file: "packages/shared/src/cliRelease.ts",
      constant: "CLI_RELEASE_REPOSITORY (`update` command feed + release download base)",
      envName: "T3CODE_CLI_UPDATE_REPOSITORY",
      upstreamDefault: '"pingdotgg/t3code"',
      effective: (e) => e.T3CODE_CLI_UPDATE_REPOSITORY!,
      mechanism: "env seam",
    },
    {
      id: "skycot-default-runtime-mode",
      file: "packages/contracts/src/providerPolicy.ts",
      constant: "DEFAULT_RUNTIME_MODE (threads that inherit the engine default)",
      envName: "T3CODE_DEFAULT_RUNTIME_MODE",
      upstreamDefault: '"full-access"',
      effective: (e) => e.T3CODE_DEFAULT_RUNTIME_MODE!,
      mechanism: "env seam",
    },
    {
      id: "skycot-policy-reactor",
      file: "apps/server/src/server.ts",
      constant: "SKYCOT hard-rule policy (server answers what no rule matches)",
      envName: "T3CODE_SKYCOT_POLICY",
      // The marker comment carries the default: the reactor layer is a no-op unless the flag is "1".
      upstreamDefault: "no-op layer unless T3CODE_SKYCOT_POLICY=1",
      effective: (e) =>
        e.T3CODE_SKYCOT_POLICY === "1" ? "enabled (hard rules enforced server-side)" : "off",
      mechanism: "env seam",
    },
    {
      id: "brand-package-name",
      file: "scripts/build-desktop-artifact.ts",
      constant: 'packaged app name (Keychain "<name> Safe Storage", updater cache)',
      envName: "T3CODE_DESKTOP_PACKAGE_NAME",
      upstreamDefault: '"t3code"',
      effective: (e) => e.T3CODE_DESKTOP_PACKAGE_NAME!,
      mechanism: "env seam",
    },
    {
      id: "brand-dmg-background",
      file: "scripts/build-desktop-artifact.ts",
      constant: "DMG installer window artwork",
      envName: "T3CODE_DESKTOP_DMG_BACKGROUND_SVG",
      upstreamDefault: 'path.join(stageResourcesDir, "dmg", `dmg-background-${channel}.svg`)',
      effective: (e) => e.T3CODE_DESKTOP_DMG_BACKGROUND_SVG!,
      mechanism: "env seam",
    },
    {
      id: "brand-copyright",
      file: "scripts/build-desktop-artifact.ts",
      constant: "copyright line (Info.plist, macOS About panel, Windows file properties)",
      envName: "T3CODE_DESKTOP_COPYRIGHT",
      upstreamDefault: "? { copyright: process.env.T3CODE_DESKTOP_COPYRIGHT }",
      effective: (e) =>
        e.T3CODE_DESKTOP_COPYRIGHT ?? "electron-builder default (Copyright © <year> T3 Tools)",
      mechanism: "env seam",
    },
    {
      id: "skycot-mac-signing",
      file: "scripts/build-desktop-artifact.ts",
      constant: "signed macOS build (T3 Connect passkey domains + provisioning profile)",
      envName: "resolveSkycotMacSigning",
      upstreamDefault: "resolveMacPasskeySigningConfiguration(loadRepoEnv({ repoRoot }))",
      effective: (e) =>
        e.T3CODE_SKYCOT_CONNECT === "off"
          ? "Developer ID + SKYCOT entitlements; no Clerk, no profile; refuses Connect settings"
          : "upstream passkey signing",
      mechanism: "env seam",
    },
    {
      id: "skycot-mac-info-strings",
      file: "scripts/build-desktop-artifact.ts",
      constant: "macOS permission prompts and URL-scheme names (Info.plist)",
      envName: "T3CODE_APP_BASE_NAME",
      upstreamDefault: "T3 Code connects to devices on your local network",
      effective: (e) => `"${e.T3CODE_APP_BASE_NAME!}" instead of "T3 Code"`,
      mechanism: "env seam",
    },
    {
      id: "telemetry-default-off",
      file: "apps/server/src/telemetry/AnalyticsService.ts",
      constant: "telemetry enabled when T3CODE_TELEMETRY_ENABLED is unset",
      envName: "T3CODE_TELEMETRY_ENABLED",
      // Recorded in the marker comment: the line itself now says withDefault(false).
      upstreamDefault: "upstream: withDefault(true)",
      effective: () => "false (env override still honoured)",
      mechanism: "hard edit (TS)",
    },
  ];
}

/** `owner/repo` of the git `origin` remote, or undefined when there is none (fresh export, CI mirror). */
function originRepository(): string | undefined {
  try {
    const url = NodeChildProcess.execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u);
    return m ? `${m[1]}/${m[2]}` : undefined;
  } catch {
    return undefined;
  }
}

/** Checks that only make sense against the resolved environment (not brand.json alone). */
function checkEnv(brand: Brand, env: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const name of ["T3CODE_DESKTOP_UPDATE_REPOSITORY", "T3CODE_CLI_UPDATE_REPOSITORY"]) {
    if (env[name] !== brand.updateRepository)
      errors.push(
        `env.cjs: ${name} must follow brand.json updateRepository (${brand.updateRepository})`,
      );
    if ((env[name] ?? "").toLowerCase().startsWith("pingdotgg/"))
      errors.push(
        `env.cjs: ${name} points at upstream (${env[name]}); users would update onto T3 Code`,
      );
  }
  // Releases are published by the repository the code lives in; a feed naming any other repo
  // either 404s forever or, worse, serves someone else's binaries.
  const origin = originRepository();
  if (origin && origin.toLowerCase() !== brand.updateRepository.toLowerCase())
    errors.push(
      `brand.json: updateRepository "${brand.updateRepository}" differs from the git origin "${origin}"; the update feed must be the repository that publishes releases`,
    );
  if (!brand.telemetryEnabledByDefault && env.T3CODE_TELEMETRY_ENABLED !== "false")
    errors.push(
      'env.cjs: T3CODE_TELEMETRY_ENABLED must be "false" while telemetryEnabledByDefault is false',
    );
  if (
    !brand.telemetry?.posthogKey &&
    !/^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/u.test(env.T3CODE_POSTHOG_HOST ?? "")
  )
    errors.push(
      `env.cjs: with no PostHog key of our own, T3CODE_POSTHOG_HOST must be the loopback sink, not "${env.T3CODE_POSTHOG_HOST}"`,
    );
  for (const name of [
    "T3CODE_DESKTOP_ICON_MAC_PNG",
    "T3CODE_DESKTOP_ICON_MAC_ICNS",
    "T3CODE_DESKTOP_ICON_LINUX_PNG",
    "T3CODE_DESKTOP_ICON_WIN_ICO",
  ]) {
    if (!env[name] || read(env[name]) === undefined)
      errors.push(`env.cjs: ${name} names "${env[name] ?? ""}", which is not a file in the repo`);
  }
  for (const file of ["LICENSE", "NOTICE", "nondev/bin/skycot.cjs"]) {
    if (read(file) === undefined)
      errors.push(`${file}: missing (shipped in every bundle / the only supported CLI entry)`);
  }
  return errors;
}

/** Values upstream already reads from the environment: no file edit, only env.cjs. */
function upstreamEnvKnobs(
  env: Record<string, string>,
): Array<{ constant: string; where: string; upstreamDefault: string; effective: string }> {
  return [
    {
      constant: "state directory (desktop + embedded server + CLI)",
      where: "apps/desktop/src/app/DesktopStatePaths.ts, apps/server/src/os-jank.ts (T3CODE_HOME)",
      upstreamDefault: "~/.t3",
      effective: env.T3CODE_HOME!,
    },
    {
      constant: "Windows AppUserModelID",
      where: "apps/desktop/src/app/DesktopEnvironment.ts (T3CODE_DESKTOP_APP_USER_MODEL_ID)",
      upstreamDefault: "com.t3tools.t3code",
      effective: env.T3CODE_DESKTOP_APP_USER_MODEL_ID!,
    },
    {
      constant: "electron-updater feed (baked into app-update.yml)",
      where:
        "scripts/build-desktop-artifact.ts seam skycot-update-feed-build (T3CODE_SKYCOT_UPDATE_FEED; never GITHUB_REPOSITORY); the app re-checks it (seam skycot-update-feed)",
      upstreamDefault: "pingdotgg/t3code via GITHUB_REPOSITORY in upstream CI",
      effective:
        env.T3CODE_SKYCOT_UPDATE_FEED === "none"
          ? "none (no updates yet)"
          : env.T3CODE_SKYCOT_UPDATE_FEED!,
    },
    {
      constant: "release links in Advanced mode",
      where: "apps/web/vite.config.ts define (T3CODE_DESKTOP_UPDATE_REPOSITORY)",
      upstreamDefault: "pingdotgg/t3code",
      effective: env.T3CODE_DESKTOP_UPDATE_REPOSITORY!,
    },
    {
      constant: "telemetry PostHog key / host",
      where:
        "apps/server/src/telemetry/AnalyticsService.ts (T3CODE_POSTHOG_KEY / T3CODE_POSTHOG_HOST)",
      upstreamDefault: "phc_XOWci… / https://ingest.t3.codes",
      effective: `${env.T3CODE_POSTHOG_KEY === "" ? "(empty)" : env.T3CODE_POSTHOG_KEY} / ${env.T3CODE_POSTHOG_HOST}`,
    },
    {
      constant: "T3 Connect (Clerk key, relay URL)",
      where: "repo .env / .env.local via scripts/lib/public-config.ts (build-time define)",
      upstreamDefault: "pk_live_… / https://relay.t3.codes when .env is copied from .env.example",
      effective: "disabled (no .env in our build)",
    },
  ];
}

function checkSeams(brand: Brand): string[] {
  const errors: string[] = [];
  for (const seam of seams()) {
    const source = read(seam.file);
    if (source === undefined) {
      errors.push(
        `${seam.file}: missing (upstream moved or deleted it; seam ${seam.id} must be re-homed)`,
      );
      continue;
    }
    const marker = `nondev-seam: ${seam.id}`;
    if (!source.includes(marker))
      errors.push(
        `${seam.file}: marker "// ${marker}" is gone (upstream merge dropped the seam; re-apply it)`,
      );
    if (!source.includes(seam.envName))
      errors.push(`${seam.file}: seam ${seam.id} no longer reads ${seam.envName}`);
    if (!source.includes(seam.upstreamDefault))
      errors.push(
        `${seam.file}: seam ${seam.id} lost upstream's default ${seam.upstreamDefault} (keep it so the change stays upstreamable)`,
      );
  }

  const packageJson = read("apps/desktop/package.json");
  if (packageJson === undefined) errors.push("apps/desktop/package.json: missing");
  else {
    const parsed = JSON.parse(packageJson) as { productName?: string };
    if (parsed.productName !== brand.productName) {
      errors.push(
        `apps/desktop/package.json: productName is ${JSON.stringify(parsed.productName)} but brand.json says ${JSON.stringify(brand.productName)} (this is the one hand-edited JSON seam; upstream's value is ${JSON.stringify(UPSTREAM_PRODUCT_NAME)})`,
      );
    }
  }

  // Protocol registration must agree between the Electron runtime and the OS-level registration.
  const buildScript = read("scripts/build-desktop-artifact.ts") ?? "";
  if (count(buildScript, "schemes: DESKTOP_PROTOCOL_SCHEMES,") !== 2) {
    errors.push(
      "scripts/build-desktop-artifact.ts: expected exactly 2 `schemes: DESKTOP_PROTOCOL_SCHEMES,` (mac + linux protocol registration)",
    );
  }

  for (const envFile of [".env", ".env.local"]) {
    const content = read(envFile);
    if (content === undefined) continue;
    if (content.includes(UPSTREAM_CLERK_KEY) || content.includes(UPSTREAM_RELAY_HOST)) {
      errors.push(
        `${envFile}: contains upstream's production Clerk key or relay URL; a build from this checkout would ship T3 Connect pointed at T3 Tools' servers. Remove it (T3 Connect stays disabled until we own a Clerk instance + relay).`,
      );
    }
  }
  return errors;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => pad(c, widths[i]!)).join(" | ")} |`;
  return [
    line(rows[0]!),
    `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
    ...rows.slice(1).map(line),
  ].join("\n");
}

function main(): number {
  process.env.T3CODE_BRAND_ENV_SKIP = "1"; // load env.cjs without mutating this process
  const mod = require("../brand/env.cjs") as BrandEnvModule;
  const brand = mod.brand;
  const env = mod.resolveBrandEnv(brand, { homedir: NodeOS.homedir() });

  if (printEnv || githubEnv) {
    const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    if (githubEnv) {
      const target = process.env.GITHUB_ENV;
      if (!target) {
        process.stderr.write(
          "--github-env: $GITHUB_ENV is not set (not running inside GitHub Actions)\n",
        );
        return 1;
      }
      NodeFS.appendFileSync(target, lines.join("\n") + "\n");
      if (!quiet) process.stdout.write(`Appended ${lines.length} brand variables to $GITHUB_ENV\n`);
    } else {
      process.stdout.write(lines.join("\n") + "\n");
    }
    return 0;
  }

  const errors = [
    ...validateBrand(brand),
    ...checkSeams(brand),
    ...checkEnv(brand, env),
    // SKYCOT's update feed: the brand's only, never T3 Code's (nondev/scripts/update-feed-guard.ts).
    ...updateFeedProblems(ROOT),
  ];

  if (!quiet) {
    const out: string[] = [];
    out.push(`Brand: ${brand.productName}  (${brand.upstreamCredit})`);
    out.push("");
    out.push(
      "What this brand changes at runtime/build versus stock T3 Code (nothing below rewrites upstream files):",
    );
    out.push("");
    const rows: string[][] = [
      ["constant", "upstream default", `${brand.productName} (effective)`, "mechanism", "where"],
    ];
    for (const s of seams())
      rows.push([
        s.constant,
        s.upstreamDefault,
        s.effective(env),
        s.mechanism,
        `${s.file} (// nondev-seam: ${s.id})`,
      ]);
    rows.push([
      "productName (electron-builder bundle/installer name, app.getName())",
      JSON.stringify(UPSTREAM_PRODUCT_NAME),
      JSON.stringify(brand.productName),
      "hard edit (JSON)",
      "apps/desktop/package.json",
    ]);
    for (const k of upstreamEnvKnobs(env))
      rows.push([k.constant, k.upstreamDefault, k.effective, "upstream env (no edit)", k.where]);
    out.push(table(rows));
    out.push("");
    out.push(
      "Environment the bootstrap applies (nondev/brand/env.cjs; existing values always win):",
    );
    for (const [k, v] of Object.entries(env)) out.push(`  ${k}=${v}`);
    out.push("");
    out.push(
      "How to use: desktop builds load env.cjs from boot.ts automatically. For the build script and the CLI:",
    );
    out.push("  node --import ./nondev/brand/env.cjs scripts/build-desktop-artifact.ts <args>");
    out.push("  node nondev/bin/skycot.cjs serve        # the CLI wrapper; loads env.cjs itself");
    out.push(
      `  analytics: ${env.T3CODE_TELEMETRY_ENABLED === "false" ? "off" : "ON"}, sink ${env.T3CODE_POSTHOG_HOST} (AnalyticsService default is off even without env.cjs)`,
    );
    out.push(
      "  eval \"$(node nondev/scripts/apply-brand.ts --env | sed 's/^/export /')\"   # or --github-env in Actions",
    );
    out.push("");
    process.stdout.write(out.join("\n") + "\n");
  }

  if (errors.length > 0) {
    process.stderr.write(
      `apply-brand: ${errors.length} problem(s)\n` +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\n",
    );
    return 1;
  }
  if (!quiet) process.stdout.write("apply-brand: all brand seams intact.\n");
  return 0;
}

process.exit(main());
