/**
 * update-feed-guard — fails when a SKYCOT build could still update from T3 Code's releases.
 *
 * SKYCOT's update feed has one source (brand.json → updates.feed → env.cjs →
 * T3CODE_SKYCOT_UPDATE_FEED) and every consumer fails closed (packages/skycot-brand/src/
 * updateFeed.ts). This guard checks the wiring that makes that true, so an upstream merge that
 * drops a seam, or a brand edit that names T3 Code, fails `apply-brand` and the fork tests
 * instead of shipping:
 *
 *   - brand.json's feed is empty or a valid feed that is not T3 Code's;
 *   - env.cjs hands that exact feed on, and never leaves the variable unset;
 *   - the other release sources the brand sets (CLI `update`, Advanced mode's links) are not T3's;
 *   - the desktop build takes the brand's feed instead of GITHUB_REPOSITORY;
 *   - the installed app passes its baked feed through the brand check;
 *   - the renderer's install call goes through the Family rule;
 *   - no committed updater config (dev-app-update.yml / app-update.yml) names T3 Code.
 *
 * Used by apply-brand.ts and update-feed-guard.test.ts (CI: `node --test nondev/scripts/*.test.ts`).
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  encodeUpdateFeed,
  isT3GitHubRepository,
  isT3ReleaseUrl,
  parseUpdateFeed,
  readUpdateFeedSetting,
  skycotPublishConfig,
  SKYCOT_UPDATE_FEED_ENV,
} from "../../packages/skycot-brand/src/updateFeed.ts";

const require = NodeModule.createRequire(import.meta.url);
export const ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);

interface BrandEnvModule {
  readonly brand: {
    readonly updateRepository: string;
    readonly updates?: { readonly feed?: string | null };
  };
  readonly resolveBrandEnv: (brand: unknown, host: { homedir: string }) => Record<string, string>;
}

function read(relativePath: string, root: string): string | undefined {
  const absolute = NodePath.join(root, relativePath);
  return NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : undefined;
}

/** Files that must route SKYCOT's updates through the brand rules: path → required snippets. */
export const REQUIRED_WIRING: ReadonlyArray<{
  readonly file: string;
  readonly snippets: ReadonlyArray<string>;
  readonly why: string;
}> = [
  {
    file: "scripts/build-desktop-artifact.ts",
    snippets: [
      "nondev-seam: skycot-update-feed-build",
      'Config.String("T3CODE_SKYCOT_UPDATE_FEED")',
      "skycotFeed.branded",
      "skycotPublishConfig(skycotFeed, updateChannel)",
    ],
    why: "the desktop build would bake GITHUB_REPOSITORY's feed (pingdotgg/t3code in upstream CI) into SKYCOT",
  },
  {
    file: "apps/desktop/src/updates/DesktopUpdates.ts",
    snippets: [
      "nondev-seam: skycot-update-feed",
      "SkycotUpdates.vetBakedFeed(yield* readAppUpdateYml)",
    ],
    why: "the installed app would use whatever feed its app-update.yml names, T3 Code's included",
  },
  {
    file: "apps/desktop/src/ipc/methods/updates.ts",
    snippets: [
      "nondev-seam: skycot-update-family-gate",
      "SkycotUpdates.installWithFamilyRule(updates)",
    ],
    why: "a child could restart into an update without the parent code",
  },
];

export function updateFeedProblems(root: string = ROOT): string[] {
  const problems: string[] = [];
  const previousSkip = process.env.T3CODE_BRAND_ENV_SKIP;
  process.env.T3CODE_BRAND_ENV_SKIP = "1"; // load env.cjs without mutating this process
  // Fresh each time: a test may have edited a copy since the last read.
  const envPath = NodePath.join(root, "nondev/brand/env.cjs");
  delete require.cache[envPath];
  delete require.cache[NodePath.join(root, "nondev/brand.json")];
  const mod = require(envPath) as BrandEnvModule;
  if (previousSkip === undefined) delete process.env.T3CODE_BRAND_ENV_SKIP;
  else process.env.T3CODE_BRAND_ENV_SKIP = previousSkip;

  const rawFeed = mod.brand.updates?.feed;
  if (mod.brand.updates === undefined || rawFeed === undefined) {
    problems.push(
      "brand.json: updates.feed is missing (null means no updates; it must be explicit)",
    );
  } else if (rawFeed !== null && typeof rawFeed !== "string") {
    problems.push("brand.json: updates.feed must be null or a string");
  }
  const parsed = parseUpdateFeed(typeof rawFeed === "string" ? rawFeed : "");
  if (parsed.problem !== null) problems.push(`brand.json: updates.feed ${parsed.problem}`);

  const env = mod.resolveBrandEnv(mod.brand, { homedir: NodeOS.homedir() });
  const envValue = env[SKYCOT_UPDATE_FEED_ENV];
  if (envValue === undefined || envValue === "") {
    problems.push(
      `env.cjs: ${SKYCOT_UPDATE_FEED_ENV} must always be set ("none" for no feed); unset or empty reads as an unbranded build`,
    );
  } else if (envValue !== encodeUpdateFeed(parsed.feed)) {
    problems.push(
      `env.cjs: ${SKYCOT_UPDATE_FEED_ENV}="${envValue}" does not follow brand.json updates.feed (${encodeUpdateFeed(parsed.feed)})`,
    );
  }
  const setting = readUpdateFeedSetting(envValue);
  if (setting.branded) {
    for (const channel of ["latest", "nightly"] as const) {
      const publish = skycotPublishConfig(setting, channel);
      if (publish !== null && Object.values(publish).some((value) => isT3ReleaseUrl(value))) {
        problems.push(`build: the ${channel} publish entry would point at T3 Code's releases`);
      }
      if (publish?.provider === "github" && isT3GitHubRepository(publish.owner!, publish.repo!)) {
        problems.push(`build: the ${channel} publish entry is T3 Code's GitHub repository`);
      }
    }
  }
  for (const name of ["T3CODE_DESKTOP_UPDATE_REPOSITORY", "T3CODE_CLI_UPDATE_REPOSITORY"]) {
    const [owner = "", repo = ""] = (env[name] ?? "").split("/");
    if (!env[name] || isT3GitHubRepository(owner, repo)) {
      problems.push(`env.cjs: ${name} must be SKYCOT's repository, not "${env[name] ?? ""}"`);
    }
  }

  for (const wiring of REQUIRED_WIRING) {
    const source = read(wiring.file, root);
    if (source === undefined) {
      problems.push(`${wiring.file}: missing; re-home the SKYCOT update seam (${wiring.why})`);
      continue;
    }
    for (const snippet of wiring.snippets) {
      if (!source.includes(snippet)) {
        problems.push(`${wiring.file}: lost "${snippet}" — ${wiring.why}. Re-apply the seam.`);
      }
    }
  }

  for (const file of [
    "apps/desktop/dev-app-update.yml",
    "apps/desktop/app-update.yml",
    "apps/desktop/resources/app-update.yml",
  ]) {
    const text = read(file, root);
    if (text !== undefined && /pingdotgg|t3code|t3\.codes/iu.test(text)) {
      problems.push(`${file}: names T3 Code's releases; SKYCOT must never ship that feed`);
    }
  }
  return problems;
}
