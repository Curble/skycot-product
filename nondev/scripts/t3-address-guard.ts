#!/usr/bin/env node
/**
 * t3-address-guard — fails when SKYCOT's engine could reach T3 Code's repository or sites at
 * runtime.
 *
 * SKYCOT is a fork of T3 Code, and T3 Code's engine fetches a few things from T3 Tools while it
 * runs (its model list from GitHub, analytics, T3 Connect). Whoever controls those addresses
 * controls what SKYCOT does, so none may be reachable. The update feed has its own guard
 * (update-feed-guard.ts); this one covers everything else:
 *
 *   - brand.json's model-list address is empty or SKYCOT's, and env.cjs always hands it on;
 *   - the engine's model list reads that address only (seam skycot-model-manifest);
 *   - T3 Connect stays off: the brand never sets a relay, a sign-in key or a hosted app, and no
 *     local `.env` points the build at T3's relay;
 *   - every remaining mention of a T3 address in the engine's runtime code (server, desktop,
 *     shared packages; tests excluded) is on the reviewed list below, with why it is never
 *     fetched. A new mention fails until someone decides.
 *
 * Run by apply-brand.ts, by t3-address-guard.test.ts (CI: `node --test nondev/scripts/*.test.ts`)
 * and directly: `node nondev/scripts/t3-address-guard.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { isT3ReleaseUrl } from "../../packages/skycot-brand/src/updateFeed.ts";

const require = NodeModule.createRequire(import.meta.url);
export const ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

export const MODEL_MANIFEST_ENV = "T3CODE_SKYCOT_MODEL_MANIFEST_URL";

/** Any spelling of a T3 Tools address: its GitHub owner, its sites. */
export const T3_ADDRESS = /pingdotgg|(?<![\w-])t3\.(?:codes|gg|chat)\b/iu;

/** Where the engine's runtime code lives (what the Mac app and `skycot serve` run). */
export const RUNTIME_ROOTS: ReadonlyArray<string> = ["apps/server/src", "apps/desktop/src"];
/** Shared packages the engine bundles; SKYCOT's own packages hold the refusal lists themselves. */
const PACKAGES_DIR = "packages";
const OWN_PACKAGES = new Set(["skycot-brand", "skycot-rules"]);

/**
 * Reviewed mentions: file → why it is never fetched at runtime. Keep each reason honest; if a
 * file starts fetching the address, remove it from here and close it like the model list.
 */
export const REVIEWED_MENTIONS: Readonly<Record<string, string>> = {
  "apps/server/src/mcp/toolkits/preview/tools.ts":
    "an example address inside a tool description the AI reads; the engine never opens it",
  "apps/server/src/cli/triagePrompt.ts":
    "the `triage` command's instructions for a developer's own AI agent; runs only when someone types `skycot triage`, never by itself",
  "apps/server/src/project/ManagedProjectFolders.ts":
    "a link written into a new project's README; text only (wording queued in BACKLOG)",
  "apps/server/src/telemetry/AnalyticsService.ts":
    "T3's analytics host as upstream's default; analytics are off by default (seam telemetry-default-off) and env.cjs points the host at this Mac",
  "packages/contracts/src/t3ProjectFile.ts":
    "the t3.json schema's documentation address; text only",
  "packages/contracts/src/environmentHttp.ts":
    "a help link for T3 Connect errors; Connect is off in SKYCOT (checked below)",
  "packages/contracts/src/previewAutomation.ts": "an example address in a schema description",
  "packages/shared/src/providerAuthReturnUrl.ts":
    "a sign-in return address the app accepts; a check on an address, no request",
  "packages/shared/src/cliRelease.ts":
    "upstream's default behind T3CODE_CLI_UPDATE_REPOSITORY, which env.cjs always sets to SKYCOT's (update-feed-guard checks it)",
  "packages/shared/src/connectAuth.ts":
    "T3 Connect's hosted app; Connect stays off without a relay and sign-in key, which SKYCOT never sets (checked below)",
  "packages/source-control-github/src/server/githubStackRebase.ts":
    "a committer email on a local rebase commit; no request",
};

/** The upstream lines that must keep the model list on the brand's address. */
export const MODEL_MANIFEST_WIRING = {
  file: "apps/server/src/provider/ModelManifest.ts",
  snippets: [
    "nondev-seam: skycot-model-manifest",
    "SkycotModelManifestSource.configuredModelManifestUrl()",
    "if (remoteManifestUrl === null) return manifest;",
    "httpClient.get(remoteManifestUrl)",
  ],
} as const;

const CONNECT_VARIABLES = [
  "T3CODE_RELAY_URL",
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "T3CODE_HOSTED_APP_URL",
];

interface BrandEnvModule {
  readonly brand: { readonly modelManifest?: { readonly url?: string | null } };
  readonly resolveBrandEnv: (brand: unknown, host: { homedir: string }) => Record<string, string>;
}

function loadBrandEnv(root: string): BrandEnvModule {
  const previousSkip = process.env.T3CODE_BRAND_ENV_SKIP;
  process.env.T3CODE_BRAND_ENV_SKIP = "1"; // load env.cjs without mutating this process
  const envPath = NodePath.join(root, "nondev/brand/env.cjs");
  delete require.cache[envPath];
  delete require.cache[NodePath.join(root, "nondev/brand.json")];
  try {
    return require(envPath) as BrandEnvModule;
  } finally {
    if (previousSkip === undefined) delete process.env.T3CODE_BRAND_ENV_SKIP;
    else process.env.T3CODE_BRAND_ENV_SKIP = previousSkip;
  }
}

function isTestFile(relativePath: string): boolean {
  return (
    /\.(test|spec|testkit|browser\.test)\.[cm]?[jt]sx?$/u.test(relativePath) ||
    /(^|\/)(test|tests|__tests__|fixtures|testkit|testing)\//u.test(relativePath)
  );
}

function sourceFiles(root: string, dir: string, out: Array<string>): void {
  const absolute = NodePath.join(root, dir);
  if (!NodeFS.existsSync(absolute)) return;
  for (const entry of NodeFS.readdirSync(absolute, { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      sourceFiles(root, relative, out);
    } else if (/\.[cm]?[jt]sx?$/u.test(entry.name) && !isTestFile(relative)) {
      out.push(relative);
    }
  }
}

/** Runtime source files of the engine, repo-relative. */
export function runtimeSourceFiles(root: string = ROOT): Array<string> {
  const files: Array<string> = [];
  for (const dir of RUNTIME_ROOTS) sourceFiles(root, dir, files);
  const packages = NodePath.join(root, PACKAGES_DIR);
  if (NodeFS.existsSync(packages)) {
    for (const name of NodeFS.readdirSync(packages)) {
      if (OWN_PACKAGES.has(name)) continue;
      sourceFiles(root, `${PACKAGES_DIR}/${name}/src`, files);
    }
  }
  return files.filter((file) => !file.includes("/skycot/"));
}

export function t3AddressProblems(root: string = ROOT): string[] {
  const problems: string[] = [];
  const mod = loadBrandEnv(root);

  const rawUrl = mod.brand.modelManifest?.url;
  if (mod.brand.modelManifest === undefined || rawUrl === undefined) {
    problems.push(
      "brand.json: modelManifest.url is missing (null means the bundled model list; it must be explicit)",
    );
  } else if (rawUrl !== null && typeof rawUrl !== "string") {
    problems.push("brand.json: modelManifest.url must be null or an https URL");
  } else if (typeof rawUrl === "string") {
    if (!/^https:\/\//iu.test(rawUrl)) {
      problems.push(`brand.json: modelManifest.url "${rawUrl}" must be an https URL`);
    }
    if (isT3ReleaseUrl(rawUrl) || T3_ADDRESS.test(rawUrl) || /\/t3code\//iu.test(rawUrl)) {
      problems.push(
        `brand.json: modelManifest.url "${rawUrl}" is T3 Code's; SKYCOT never fetches it`,
      );
    }
  }

  const env = mod.resolveBrandEnv(mod.brand, { homedir: NodeOS.homedir() });
  const expected = typeof rawUrl === "string" && rawUrl.trim() !== "" ? rawUrl.trim() : "none";
  if (!env[MODEL_MANIFEST_ENV]) {
    problems.push(
      `env.cjs: ${MODEL_MANIFEST_ENV} must always be set ("none" for the bundled model list)`,
    );
  } else if (env[MODEL_MANIFEST_ENV] !== expected) {
    problems.push(
      `env.cjs: ${MODEL_MANIFEST_ENV}="${env[MODEL_MANIFEST_ENV]}" does not follow brand.json modelManifest.url (${expected})`,
    );
  }

  for (const name of CONNECT_VARIABLES) {
    if (env[name] !== undefined && env[name] !== "") {
      problems.push(`env.cjs: sets ${name}; T3 Connect must stay off until SKYCOT runs its own`);
    }
  }
  const dotEnv = NodePath.join(root, ".env");
  if (NodeFS.existsSync(dotEnv)) {
    for (const line of NodeFS.readFileSync(dotEnv, "utf8").split(/\r?\n/u)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/u.exec(line);
      if (match && CONNECT_VARIABLES.includes(match[1]!) && T3_ADDRESS.test(match[2]!)) {
        problems.push(
          `.env: ${match[1]} names T3's service; a build from this checkout would turn T3 Connect on`,
        );
      }
    }
  }

  const manifestSource = read(root, MODEL_MANIFEST_WIRING.file);
  if (manifestSource === undefined) {
    problems.push(`${MODEL_MANIFEST_WIRING.file}: missing; re-home the seam skycot-model-manifest`);
  } else {
    for (const snippet of MODEL_MANIFEST_WIRING.snippets) {
      if (!manifestSource.includes(snippet)) {
        problems.push(
          `${MODEL_MANIFEST_WIRING.file}: lost "${snippet}"; the model list could be fetched from T3 Code's repository again. Re-apply the seam.`,
        );
      }
    }
  }

  for (const file of runtimeSourceFiles(root)) {
    const text = read(root, file);
    if (text === undefined || !T3_ADDRESS.test(text)) continue;
    if (REVIEWED_MENTIONS[file] !== undefined) continue;
    const line = text.split("\n").findIndex((candidate) => T3_ADDRESS.test(candidate)) + 1;
    problems.push(
      `${file}:${line}: names a T3 Code address in the engine's runtime code. If it is fetched, route it through brand.json (like the model list) or remove it; if it is only text, add it to REVIEWED_MENTIONS with why.`,
    );
  }
  return problems;
}

function read(root: string, relativePath: string): string | undefined {
  const absolute = NodePath.join(root, relativePath);
  return NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : undefined;
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const problems = t3AddressProblems();
  if (problems.length > 0) {
    process.stderr.write(`t3-address-guard: ${problems.length} problem(s)\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write("t3-address-guard: no T3 Code address is reachable from the engine\n");
}
