// nondev-seam: skycot-rules-package
// Add-ons in the Family profile: what an install or a one-file download asks for, and the short
// list of add-ons SKYCOT fetches by itself. One place, so the engine (which answers the request
// and does the install itself, SkycotApprovedInstalls) and the cards (which say who has to say
// yes) always agree. Pure functions over strings; no URL or Node APIs (the phone app runs it).
//
// First principles: a child making a game needs three.js or p5 many times a week, and asking a
// grown-up for the same well-known library each time teaches everyone to press yes without
// reading. These add-ons are fetched by SKYCOT itself, from the public npm registry or the two
// big npm CDNs, with install scripts off and never by the sandboxed command, so the risk a
// grown-up's yes guarded (running a stranger's code at install time) is not there. Anything
// else, any other host, any other command shape, still waits for a grown-up exactly as before.

export type InstallManager = "npm" | "pnpm" | "bun";

export interface ApprovedInstall {
  readonly manager: InstallManager;
  readonly packages: ReadonlyArray<string>;
  readonly dev: boolean;
  readonly exact?: true;
}

const MAX_PACKAGES = 10;

// A registry name, optionally scoped, optionally with a version or tag. No paths, URLs,
// `git:` or `file:` specs, and nothing that starts like a flag.
const PACKAGE_SPEC =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[A-Za-z0-9][A-Za-z0-9.^~<>=*_+|-]*)?$/u;

const INSTALL_VERBS: Record<string, ReadonlySet<string>> = {
  npm: new Set(["install", "i", "add"]),
  pnpm: new Set(["add"]),
  bun: new Set(["add"]),
};
const DEV_FLAGS = new Set(["-D", "--save-dev", "--dev", "-d"]);
// Flags that only repeat what the install does anyway.
const HARMLESS_FLAGS = new Set([
  "-S",
  "--save",
  "--save-prod",
  "-P",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--save-exact",
  "-E",
]);

// The cache hint is dropped: SKYCOT uses its normal cache, never a command-supplied path.
function projectCachePath(value: string | undefined): boolean {
  return (
    value !== undefined &&
    value.length > 0 &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every((part) => part !== ".." && /^[A-Za-z0-9._-]+$/u.test(part) && !part.startsWith("-"))
  );
}

/** `/bin/zsh -lc 'npm install three'` as Codex reports it, or the bare command. */
export function unwrapShell(command: string): string {
  const match = /^(?:\/bin\/|\/usr\/bin\/)?(?:zsh|bash|sh)\s+-l?c\s+(['"])([\s\S]*)\1$/u.exec(
    command.trim(),
  );
  return (match?.[2] ?? command).trim();
}

/**
 * The add-ons a command installs, when that is all it does; null for anything else. Pure, so
 * the rule can be read and tested on its own.
 */
export function parseApprovedInstall(command: string | undefined): ApprovedInstall | null {
  if (command === undefined) return null;
  const inner = unwrapShell(command);
  // One plain command: no chaining, pipes, redirects, substitutions or quotes.
  if (/[;&|<>`$()'"\\\n]/u.test(inner)) return null;
  const [program, verb, ...rest] = inner.split(/\s+/u);
  if (program === undefined || verb === undefined) return null;
  const verbs = INSTALL_VERBS[program];
  if (verbs === undefined || !verbs.has(verb)) return null;
  let dev = false;
  let exact = false;
  const packages: Array<string> = [];
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    if (word === "--cache" || word.startsWith("--cache=")) {
      const cache = word === "--cache" ? rest[++index] : word.slice("--cache=".length);
      if (!projectCachePath(cache)) return null;
      continue;
    }
    if (word === "--save-exact" || word === "-E") exact = true;
    else if (DEV_FLAGS.has(word)) dev = true;
    else if (HARMLESS_FLAGS.has(word)) continue;
    else if (PACKAGE_SPEC.test(word)) packages.push(word);
    else return null;
  }
  if (packages.length === 0 || packages.length > MAX_PACKAGES) return null;
  return { manager: program as InstallManager, packages, dev, ...(exact ? { exact: true } : {}) };
}

export interface ApprovedDownload {
  /** The https address, exactly as asked. */
  readonly url: string;
  /** Where it goes, relative to the conversation's folder. */
  readonly output: string;
  /** Folders a leading `mkdir -p …` asked for, made inside the conversation's folder too. */
  readonly folders?: ReadonlyArray<string>;
}

const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/[A-Za-z0-9._~%/+=,@:-]*$/u;
// curl's quiet, fail-on-error and follow-redirects flags, alone or bundled (-fsSL); never -k.
const CURL_SHORT_FLAGS = /^-[fsSL]+$/u;
const CURL_LONG_FLAGS = new Set([
  "--location",
  "--fail",
  "--silent",
  "--show-error",
  "--create-dirs",
  "--compressed",
]);
const CURL_FLAGS_WITH_NUMBER = new Set(["-m", "--max-time", "--retry", "--connect-timeout"]);
const WGET_FLAGS = new Set(["-q", "--quiet", "-nv", "--no-verbose"]);

/** A file name or path inside the folder: no `..`, nothing hidden, nothing absolute. */
function safeOutputPath(output: string): string | null {
  if (output.length === 0 || /^[/-]/u.test(output) || output.length > 200) return null;
  const parts = output.split("/");
  if (
    parts.some(
      (part) => part.length === 0 || part.startsWith(".") || !/^[A-Za-z0-9._-]+$/u.test(part),
    )
  )
    return null;
  return parts.join("/");
}

/**
 * The one file a command downloads, when that is all it does: `curl` or `wget` of one https
 * address into one file inside the folder. Null for anything else (stdout, pipes, several
 * addresses, `-k`, uploads, headers, cookies). Pure, like parseApprovedInstall.
 */
export function parseApprovedDownload(command: string | undefined): ApprovedDownload | null {
  if (command === undefined) return null;
  // `mkdir -p vendor && curl … -o vendor/three.module.js https://…` is the same one download
  // (seen live, 24 October 2026): leading mkdirs of plain folders inside the project are allowed.
  const steps = unwrapShell(command).split(/\s+&&\s+/u);
  const folders: Array<string> = [];
  for (const step of steps.slice(0, -1)) {
    const mkdir = /^mkdir(?:\s+-p)?\s+(\S.*)$/u.exec(step);
    if (mkdir === null) return null;
    for (const folder of mkdir[1]!.split(/\s+/u)) {
      const safe = safeOutputPath(folder);
      if (safe === null) return null;
      folders.push(safe);
    }
  }
  const inner = steps[steps.length - 1]!;
  if (/[;&|<>`$()'"\\\n]/u.test(inner)) return null;
  const [program, ...rest] = inner.split(/\s+/u);
  if (program !== "curl" && program !== "wget") return null;
  let url: string | null = null;
  let output: string | null = null;
  let remoteName = false;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    const next = rest[index + 1];
    if (program === "curl" && (CURL_SHORT_FLAGS.test(word) || CURL_LONG_FLAGS.has(word))) continue;
    if (program === "curl" && CURL_FLAGS_WITH_NUMBER.has(word) && next && /^\d+$/u.test(next)) {
      index++;
      continue;
    }
    if (program === "curl" && (word === "-O" || word === "--remote-name")) {
      remoteName = true;
      continue;
    }
    if (program === "wget" && WGET_FLAGS.has(word)) continue;
    if (
      ((program === "curl" && (word === "-o" || word === "--output")) ||
        (program === "wget" && word === "-O")) &&
      next !== undefined
    ) {
      if (output !== null) return null;
      output = next;
      index++;
      continue;
    }
    if (HTTPS_URL.test(word)) {
      if (url !== null) return null;
      url = word;
      continue;
    }
    return null;
  }
  if (url === null) return null;
  if (output === null && (remoteName || program === "wget")) {
    output = safeDecode(urlPath(url).split("/").pop() ?? "");
  }
  const safe = output === null ? null : safeOutputPath(output);
  if (safe === null) return null;
  return folders.length === 0 ? { url, output: safe } : { url, output: safe, folders };
}

function urlPath(url: string): string {
  return url.replace(/^https:\/\/[^/]+/u, "");
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

/** An add-on SKYCOT fetches without a grown-up, and the name people know it by. */
export interface TrustedAddOn {
  /** The exact npm package name. */
  readonly name: string;
  /** "three.js", for the activity log and the card. */
  readonly label: string;
}

/** The curated list. Exact package names; any version the parsers accept. */
export const TRUSTED_ADD_ONS: ReadonlyArray<TrustedAddOn> = [
  { name: "three", label: "three.js" },
  { name: "p5", label: "p5.js" },
  { name: "phaser", label: "Phaser" },
  { name: "canvas-confetti", label: "canvas-confetti" },
  { name: "matter-js", label: "Matter.js" },
  { name: "tone", label: "Tone.js" },
  { name: "howler", label: "howler.js" },
  { name: "gsap", label: "GSAP" },
  { name: "chart.js", label: "Chart.js" },
  { name: "kaplay", label: "KAPLAY" },
];

const TRUSTED_BY_NAME: ReadonlyMap<string, TrustedAddOn> = new Map(
  TRUSTED_ADD_ONS.map((addOn) => [addOn.name, addOn]),
);

/** The card's words for a trusted add-on. */
export const TRUSTED_ADD_ON_SENTENCE = "It's a trusted add-on: SKYCOT fetches it.";

/** "three" from "three@0.160.0", "@types/three" from "@types/three@0.186.1". */
export function packageNameOf(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

const CDN_PACKAGE =
  /^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@[A-Za-z0-9._^~+-]+)?(\/[A-Za-z0-9._~+@-]+(?:\/[A-Za-z0-9._~+@-]+)*)?\/?$/u;

/**
 * The npm package a download fetches, when it comes from https://cdn.jsdelivr.net/npm/… or
 * https://unpkg.com/…; null for any other address. Exact lowercase hosts, no port, no `%`
 * escapes, no `.` or `..` steps in the path (a CDN path that climbed out of /npm/ would be
 * another place altogether).
 */
export function cdnPackageOf(url: string): string | null {
  const match = CDN_PACKAGE.exec(url);
  if (match === null) return null;
  const rest = match[2] ?? "";
  if (rest.split("/").some((part) => part === "." || part === "..")) return null;
  return match[1]!;
}

/** What an add-on ask is for: the package names it names (empty for a plain web file). */
export interface AddOnAsk {
  readonly kind: "install" | "download";
  readonly names: ReadonlyArray<string>;
}

/** The add-on a command asks for, when SKYCOT's installer would take it; null otherwise. */
export function addOnAskOf(command: string | undefined): AddOnAsk | null {
  const install = parseApprovedInstall(command);
  if (install !== null) {
    return { kind: "install", names: [...new Set(install.packages.map(packageNameOf))] };
  }
  const download = parseApprovedDownload(command);
  if (download === null) return null;
  const name = cdnPackageOf(download.url);
  return { kind: "download", names: name === null ? [] : [name] };
}

/** Every package it names is on the trusted list (a download: from one of the two CDNs). */
export function isTrustedAddOnAsk(ask: AddOnAsk | null): boolean {
  return (
    ask !== null && ask.names.length > 0 && ask.names.every((name) => TRUSTED_BY_NAME.has(name))
  );
}

/** "three.js", or the package name itself for one not on the list. */
export function addOnLabel(name: string): string {
  return TRUSTED_BY_NAME.get(name)?.label ?? name;
}

/** "three.js and p5.js". */
export function describeAddOns(names: ReadonlyArray<string>): string {
  const labels = names.map(addOnLabel);
  if (labels.length <= 1) return labels[0] ?? "an add-on";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
