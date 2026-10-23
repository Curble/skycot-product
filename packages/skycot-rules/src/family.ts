// nondev-seam: skycot-rules-package
// The Family profile's extra rules. On top of the hard rules (which already hold deleting,
// leaving the project, publishing and secrets), a child's assistant must not reach the
// internet or install anything without a grown-up. A request any of these match needs the
// parent code before it can be allowed; the server refuses the "Allow" otherwise, and the
// card says "Ask a grown-up". Pure functions over strings, shared by server and client.

import {
  evaluateRequest,
  type RuleContext,
  type RuleEvaluation,
  type RuleRequest,
} from "./rules.ts";
import {
  commandSubstitutions,
  innerShellScript,
  normalizeForMatching,
  programBaseName,
  programTokens,
  splitShellSegments,
  tokenize,
  unwrapShellWrapper,
} from "./shell.ts";

export type FamilyRuleId = "uses-internet" | "installs-software" | "admin-rights";

export interface FamilyRule {
  readonly id: FamilyRuleId;
  /** Settings row: "Using the internet". */
  readonly title: string;
  /** Card phrase: "uses the internet". */
  readonly held: string;
}

export const FAMILY_RULES: ReadonlyArray<FamilyRule> = [
  { id: "uses-internet", title: "Using the internet", held: "uses the internet" },
  { id: "installs-software", title: "Installing apps or add-ons", held: "installs something" },
  {
    id: "admin-rights",
    title: "Changing how the Mac itself is set up",
    held: "changes how the Mac is set up",
  },
];

export interface FamilyMatch {
  readonly rule: FamilyRule;
  readonly detail?: string;
}

export interface FamilyRequest extends RuleRequest {
  /**
   * The tool call's turn-item type when known. `web_search` is how both Claude's WebFetch /
   * WebSearch and Codex's web search arrive, so it is the internet whatever the prompt says.
   */
  readonly toolItemType?: string | undefined;
}

export interface FamilyEvaluation {
  /** True when only a grown-up may allow this request. */
  readonly needsGrownUp: boolean;
  /** The ordinary hard-rule evaluation (its holds count too). */
  readonly base: RuleEvaluation;
  readonly family: ReadonlyArray<FamilyMatch>;
}

const FAMILY_BY_ID: ReadonlyMap<FamilyRuleId, FamilyRule> = new Map(
  FAMILY_RULES.map((rule) => [rule.id, rule]),
);
const familyRule = (id: FamilyRuleId): FamilyRule => FAMILY_BY_ID.get(id)!;

/** Programs whose whole job is talking to another computer. */
const NETWORK_PROGRAMS = new Set([
  "curl",
  "wget",
  "http",
  "https",
  "httpie",
  "xh",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "rsync",
  "ping",
  "dig",
  "nslookup",
  "host",
  "gh",
  "glab",
  "aws",
  "gcloud",
  "az",
  "gsutil",
  "ngrok",
  "cloudflared",
  "tailscale",
  "lynx",
  "w3m",
  "aria2c",
  "yt-dlp",
  "youtube-dl",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_INSTALL_SUBCOMMANDS =
  /^(install|i|add|ci|update|up|upgrade|dlx|x|exec|create|init|link|global|rebuild|import)$/;
const PYTHON_INSTALLERS = new Set(["pip", "pip3", "pipx", "uv", "poetry", "conda", "mamba"]);
const SYSTEM_INSTALLERS = new Set([
  "brew",
  "port",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pacman",
  "snap",
  "flatpak",
  "mas",
  "softwareupdate",
  "installer",
  "winget",
  "choco",
  "scoop",
]);
/** Package runners that fetch a package before running it. */
const DOWNLOADING_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const ADMIN_PROGRAMS = new Set([
  "sudo",
  "su",
  "doas",
  "launchctl",
  "defaults",
  "systemsetup",
  "networksetup",
  "scutil",
  "csrutil",
  "spctl",
  "pmset",
  "dscl",
  "crontab",
  "osascript",
]);
const GIT_NETWORK_SUBCOMMANDS = /^(push|pull|fetch|clone|ls-remote|submodule|remote)$/;
const URL_PATTERN = /\b(?:https?|ftp|wss?):\/\/|\bgit@[\w.-]+:/i;

function segmentMatches(segment: string): Array<FamilyMatch> {
  const inner = innerShellScript(segment);
  if (inner !== null) {
    return splitShellSegments(normalizeForMatching(inner)).flatMap(segmentMatches);
  }
  const matches: Array<FamilyMatch> = [];
  const hit = (id: FamilyRuleId) => matches.push({ rule: familyRule(id), detail: segment });
  // The raw words, before `programTokens` strips `sudo` and `npx` to find the real program:
  // here the wrapper is the point.
  const raw = tokenize(segment).map((token) => programBaseName(token).toLowerCase());
  if (raw.some((token) => ADMIN_PROGRAMS.has(token))) hit("admin-rights");
  const first = raw.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  const head = first >= 0 ? raw[first] : undefined;
  const second = first >= 0 ? raw[first + 1] : undefined;
  if (
    (head !== undefined && DOWNLOADING_RUNNERS.has(head)) ||
    ((head === "pnpm" || head === "yarn") && second === "dlx") ||
    (head === "deno" && /\b(npm|jsr|https?):/.test(segment))
  ) {
    hit("installs-software");
    hit("uses-internet");
  }

  const tokens = programTokens(segment);
  const program = tokens[0];
  if (program === undefined) return matches;
  const base = programBaseName(program).toLowerCase();
  const positional = tokens.slice(1).filter((arg) => !arg.startsWith("-"));
  const sub = positional[0]?.toLowerCase() ?? "";

  if (NETWORK_PROGRAMS.has(base)) hit("uses-internet");
  if (base === "git" && GIT_NETWORK_SUBCOMMANDS.test(sub)) hit("uses-internet");
  if (base === "open" && URL_PATTERN.test(segment)) hit("uses-internet");
  if (PACKAGE_MANAGERS.has(base) && PACKAGE_INSTALL_SUBCOMMANDS.test(sub)) {
    hit("installs-software");
    hit("uses-internet");
  }
  // `yarn` alone installs; `bun install` is covered above.
  if (base === "yarn" && positional.length === 0) {
    hit("installs-software");
    hit("uses-internet");
  }
  if (PACKAGE_MANAGERS.has(base) && /^(publish|login|adduser|whoami|view|info|search)$/.test(sub))
    hit("uses-internet");
  if (
    (PYTHON_INSTALLERS.has(base) &&
      /^(install|add|sync|lock|update|upgrade|download)$/.test(sub)) ||
    ((base === "python" || base === "python3") && /(^|\s)-m\s+(pip|ensurepip)\b/.test(segment))
  ) {
    hit("installs-software");
    hit("uses-internet");
  }
  if (SYSTEM_INSTALLERS.has(base)) {
    hit("installs-software");
    hit("uses-internet");
  }
  if (
    (base === "gem" && /^(install|update)$/.test(sub)) ||
    (base === "cargo" && /^(install|add|fetch|update)$/.test(sub)) ||
    (base === "go" && /^(get|install)$/.test(sub)) ||
    (base === "go" && sub === "mod" && positional[1] === "download") ||
    (base === "composer" && /^(install|require|update)$/.test(sub)) ||
    (base === "docker" && /^(pull|run|build|login|push)$/.test(sub)) ||
    (base === "xcode-select" && segment.includes("--install"))
  ) {
    hit("installs-software");
    hit("uses-internet");
  }
  if (URL_PATTERN.test(segment)) hit("uses-internet");
  return matches;
}

function unique(matches: ReadonlyArray<FamilyMatch>): Array<FamilyMatch> {
  const seen = new Set<FamilyRuleId>();
  return matches.filter((match) => {
    if (seen.has(match.rule.id)) return false;
    seen.add(match.rule.id);
    return true;
  });
}

/** The family rules a shell command trips; empty for ordinary project work. */
export function familyCommandMatches(command: string): Array<FamilyMatch> {
  const text = normalizeForMatching(unwrapShellWrapper(command.trim()));
  const matches = splitShellSegments(text).flatMap(segmentMatches);
  for (const inner of commandSubstitutions(text)) {
    matches.push(...splitShellSegments(inner).flatMap(segmentMatches));
  }
  return unique(matches);
}

/**
 * The one entry point both sides use. Anything a hard rule holds needs a grown-up, and so does
 * anything that reaches the internet or installs software. Everything else the child may
 * allow (or decline) on their own card.
 */
export function evaluateFamilyRequest(
  request: FamilyRequest,
  ctx: RuleContext = {},
): FamilyEvaluation {
  const base = evaluateRequest(request, ctx);
  const family: Array<FamilyMatch> = [];
  if (request.toolItemType === "web_search") {
    family.push({ rule: familyRule("uses-internet"), detail: request.command ?? "web search" });
  }
  if (request.kind === "command" && request.command !== undefined) {
    family.push(...familyCommandMatches(request.command));
  }
  const matches = unique(family);
  return { needsGrownUp: base.decision === "hold" || matches.length > 0, base, family: matches };
}

/** "uses the internet and installs something" for the card. */
export function describeFamilyMatches(matches: ReadonlyArray<FamilyMatch>): string {
  const parts = matches.map((match) => match.rule.held);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The approval id a grown-up's parent code is recorded against when they let one conversation
 * be deleted. Deleting cannot be undone, so the "yes" names that one conversation and is spent
 * by the delete; it never opens anything else (unlike Advanced mode's grant).
 */
export const deleteConversationApprovalId = (threadId: string) => `delete-conversation:${threadId}`;
