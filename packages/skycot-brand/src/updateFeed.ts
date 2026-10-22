/**
 * Where SKYCOT looks for new versions of itself, and the rule that it is never T3 Code's.
 *
 * SKYCOT is a fork of T3 Code. An update feed that pointed at T3 Code's releases would quietly
 * replace SKYCOT with T3 Code on the next restart, and with it every Family rule the engine
 * keeps. So the feed has exactly one source, `nondev/brand.json` → `updates.feed`, which
 * `nondev/brand/env.cjs` hands on as `T3CODE_SKYCOT_UPDATE_FEED`, and every consumer fails
 * closed: no feed, a malformed feed, or anything that names T3 Code's releases means "no
 * updates", never "fall back to the default".
 *
 * Read by the desktop build (which bakes the feed into the app as `app-update.yml`), the
 * desktop app (which refuses any baked feed that is not the brand's), the engine (which can
 * tell a browser that a newer SKYCOT exists) and the brand checks. Pure: no I/O, no clock.
 *
 * The variable's value is one string:
 *   "none"                     no feed (today: SKYCOT has no public download yet). Not "": an
 *                              empty variable reads as absent in some config readers (Effect's),
 *                              which would look like an unbranded process.
 *   "https://host/path/"       electron-updater's `generic` provider: `<url>latest-mac.yml`
 *   "github:owner/repo"        public GitHub releases of `owner/repo`
 * Plain `http://` is accepted only for this computer (127.0.0.1, localhost), for a fake feed
 * in tests; a real feed is always https.
 */

export const SKYCOT_UPDATE_FEED_ENV = "T3CODE_SKYCOT_UPDATE_FEED";
export const NO_UPDATE_FEED = "none";

export type SkycotUpdateFeed =
  | { readonly provider: "generic"; readonly url: string }
  | { readonly provider: "github"; readonly owner: string; readonly repo: string };

/**
 * What the environment says about the feed. `branded: false` means the variable is absent: the
 * process was started without SKYCOT's brand bootstrap, which a SKYCOT build never does.
 */
export type SkycotUpdateFeedSetting =
  | { readonly branded: false }
  | {
      readonly branded: true;
      readonly feed: SkycotUpdateFeed | null;
      /** Why a non-empty value was refused (and so means "no feed"). */
      readonly problem: string | null;
    };

/** GitHub owners and repositories that publish T3 Code builds. */
const T3_GITHUB_OWNERS = new Set(["pingdotgg", "t3tools", "t3-tools"]);
const T3_GITHUB_REPOS = new Set(["t3code", "t3-code"]);
/** Hosts T3 Tools serves its apps, downloads and update files from. */
const T3_HOST_SUFFIXES = ["t3.codes", "t3.gg", "t3.chat"];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface ParsedUrl {
  readonly scheme: "http" | "https";
  readonly host: string;
  readonly port: string | null;
  readonly path: string;
}

function parseUrl(value: string): ParsedUrl | null {
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^/?#:@\s]+)(?::(\d{1,5}))?(\/[^?#\s]*)?$/iu.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    scheme: match[1]!.toLowerCase() as "http" | "https",
    host: match[2]!.toLowerCase(),
    port: match[3] ?? null,
    path: match[4] ?? "/",
  };
}

function isT3Host(host: string): boolean {
  return T3_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** A GitHub owner/repo pair that is T3 Code's (or a copy named like it). */
export function isT3GitHubRepository(owner: string, repo: string): boolean {
  return (
    T3_GITHUB_OWNERS.has(owner.trim().toLowerCase()) ||
    T3_GITHUB_REPOS.has(
      repo
        .trim()
        .toLowerCase()
        .replace(/\.git$/u, ""),
    )
  );
}

/** Whether a URL serves T3 Code's releases: its sites, or its GitHub repository's files. */
export function isT3ReleaseUrl(value: string): boolean {
  const url = parseUrl(value);
  if (url === null) return /pingdotgg|t3\.codes/iu.test(value);
  if (isT3Host(url.host)) return true;
  if (
    url.host === "github.com" ||
    url.host === "api.github.com" ||
    url.host === "codeload.github.com" ||
    url.host === "raw.githubusercontent.com" ||
    url.host === "objects.githubusercontent.com"
  ) {
    const [first, second, third] = url.path.split("/").filter((part) => part.length > 0);
    // api.github.com/repos/<owner>/<repo>/…
    const [owner, repo] = first === "repos" ? [second, third] : [first, second];
    if (owner && repo && isT3GitHubRepository(owner, repo)) return true;
  }
  return /pingdotgg/iu.test(url.path);
}

export function isT3UpdateFeed(feed: SkycotUpdateFeed): boolean {
  return feed.provider === "github"
    ? isT3GitHubRepository(feed.owner, feed.repo)
    : isT3ReleaseUrl(feed.url);
}

/** A generic feed's folder URL with exactly one trailing slash (electron-updater appends file names). */
function normalizeFolderUrl(url: ParsedUrl): string {
  const path = url.path.endsWith("/") ? url.path : `${url.path}/`;
  return `${url.scheme}://${url.host}${url.port ? `:${url.port}` : ""}${path}`;
}

/** Parses one feed value. `null` with a problem for anything that is not a usable SKYCOT feed. */
export function parseUpdateFeed(raw: string): {
  readonly feed: SkycotUpdateFeed | null;
  readonly problem: string | null;
} {
  const value = raw.trim();
  if (value === "" || value === NO_UPDATE_FEED) return { feed: null, problem: null };
  const github = /^github:([\w.-]+)\/([\w.-]+)$/u.exec(value);
  if (github) {
    const feed = { provider: "github", owner: github[1]!, repo: github[2]! } as const;
    return isT3UpdateFeed(feed)
      ? { feed: null, problem: `"${value}" is T3 Code's release feed` }
      : { feed, problem: null };
  }
  const url = parseUrl(value);
  if (url === null)
    return { feed: null, problem: `"${value}" is not an https URL or github:owner/repo` };
  if (url.scheme === "http" && !LOOPBACK_HOSTS.has(url.host)) {
    return { feed: null, problem: `"${value}" must use https (plain http only for this computer)` };
  }
  const feed = { provider: "generic", url: normalizeFolderUrl(url) } as const;
  return isT3UpdateFeed(feed)
    ? { feed: null, problem: `"${value}" serves T3 Code's releases` }
    : { feed, problem: null };
}

/** The feed setting from an environment (`process.env`, or a Config provider's view of it). */
export function readUpdateFeedSetting(value: string | undefined): SkycotUpdateFeedSetting {
  if (value === undefined) return { branded: false };
  return { branded: true, ...parseUpdateFeed(value) };
}

/** The inverse of `parseUpdateFeed`, for `env.cjs`'s checks and tests. */
export function encodeUpdateFeed(feed: SkycotUpdateFeed | null): string {
  if (feed === null) return NO_UPDATE_FEED;
  return feed.provider === "github" ? `github:${feed.owner}/${feed.repo}` : feed.url;
}

/**
 * electron-builder's `publish` entry for a SKYCOT build: the brand's feed, or null for none.
 * Unlike upstream's build, this never falls back to `GITHUB_REPOSITORY` or any other source.
 */
export function skycotPublishConfig(
  setting: Extract<SkycotUpdateFeedSetting, { branded: true }>,
  channel: "latest" | "nightly",
): Record<string, string> | null {
  const feed = setting.feed;
  if (feed === null || isT3UpdateFeed(feed)) return null;
  const nightly = channel === "nightly" ? { channel: "nightly" } : {};
  return feed.provider === "github"
    ? {
        provider: "github",
        owner: feed.owner,
        repo: feed.repo,
        releaseType: channel === "nightly" ? "prerelease" : "release",
        ...nightly,
      }
    : { provider: "generic", url: feed.url, ...nightly };
}

export type AppUpdateFeedVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Whether the feed baked into an installed app (`app-update.yml`, already split into its
 * `key: value` lines) may be used. Only the brand's own feed passes; T3 Code's never does,
 * even in a process that somehow started without the brand bootstrap.
 */
export function vetAppUpdateConfig(
  config: Readonly<Record<string, string>>,
  setting: SkycotUpdateFeedSetting,
): AppUpdateFeedVerdict {
  const provider = (config["provider"] ?? "").trim().toLowerCase();
  const baked: SkycotUpdateFeed | null =
    provider === "github" && config["owner"] && config["repo"]
      ? { provider: "github", owner: config["owner"].trim(), repo: config["repo"].trim() }
      : provider === "generic" && config["url"]
        ? { provider: "generic", url: config["url"].trim() }
        : null;
  if (baked === null) {
    return {
      allowed: false,
      reason: `the app's update feed (${provider || "none"}) is not one SKYCOT uses`,
    };
  }
  if (isT3UpdateFeed(baked) || Object.values(config).some((value) => isT3ReleaseUrl(value))) {
    return { allowed: false, reason: "the app's update feed points at T3 Code's releases" };
  }
  if (!setting.branded) {
    return { allowed: false, reason: "SKYCOT's brand settings were not loaded" };
  }
  const expected = setting.feed;
  if (expected === null) {
    return { allowed: false, reason: "SKYCOT has no update feed yet" };
  }
  // Both sides through the same parser, so "…/mac" and "…/mac/" or a host's case do not matter.
  const normalized = parseUpdateFeed(encodeUpdateFeed(baked)).feed;
  const same =
    normalized !== null &&
    encodeUpdateFeed(normalized).toLowerCase() === encodeUpdateFeed(expected).toLowerCase();
  return same
    ? { allowed: true }
    : { allowed: false, reason: "the app's update feed is not the one in SKYCOT's brand settings" };
}

/** Where the newest Mac version is described, for an engine that wants to know (no download). */
export function latestMacManifestUrl(feed: SkycotUpdateFeed): string | null {
  if (isT3UpdateFeed(feed)) return null;
  return feed.provider === "github"
    ? `https://github.com/${feed.owner}/${feed.repo}/releases/latest/download/latest-mac.yml`
    : `${feed.url}latest-mac.yml`;
}

/** The `version:` line of an electron-builder `latest-mac.yml`. */
export function readManifestVersion(text: string): string | null {
  const match = /^version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)['"]?\s*$/mu.exec(
    text,
  );
  return match ? match[1]! : null;
}

/**
 * Semantic-version order: negative when `a` is older than `b`. A pre-release ("1.2.0-beta.1")
 * comes before its release. Unreadable versions compare equal, so nothing is offered.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/u.exec(value.trim());
    return match
      ? {
          core: [Number(match[1]), Number(match[2]), Number(match[3])],
          pre: match[4] ? match[4].split(".") : [],
        }
      : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (left === null || right === null) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference !== 0) return difference;
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return (left.pre.length === 0 ? 1 : 0) - (right.pre.length === 0 ? 1 : 0);
  }
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const l = left.pre[index];
    const r = right.pre[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/u.test(l) ? Number(l) : null;
    const rn = /^\d+$/u.test(r) ? Number(r) : null;
    if (ln !== null && rn !== null && ln !== rn) return ln - rn;
    if (ln === null || rn === null) {
      if (l !== r) return ln !== null ? -1 : rn !== null ? 1 : l < r ? -1 : 1;
    }
  }
  return 0;
}
