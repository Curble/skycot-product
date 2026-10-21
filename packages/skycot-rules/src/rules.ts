// nondev-seam: skycot-rules-package
// The SKYCOT hard rules. One table, two readers: the server-side policy reactor decides
// what to hold for the person (everything else it approves), and the plain client renders
// the same rules in Settings and on approval cards. Pure functions over strings; no I/O.
//
// A rule that *matches* means "hold this for a human". Not matching means the request may
// be auto-approved. Rules err towards matching: a false hold costs one tap, a false allow
// can delete work.

import { isOutsideProject, isSecretPath, type PromptFile } from "./files.ts";
import {
  commandSubstitutions,
  innerShellScript,
  normalizeForMatching,
  programBaseName,
  programTokens,
  splitShellSegments,
  unwrapShellWrapper,
} from "./shell.ts";

export type HardRuleId =
  | "deletes-files"
  | "destructive-git"
  | "pushes-to-live"
  | "outside-project"
  | "leaves-sandbox"
  | "reads-outside-project"
  | "pipes-to-shell"
  | "sends-data-out"
  | "publishes-or-deploys"
  | "payments"
  | "secrets"
  | "destructive-command"
  | "connected-app";

export type HardRuleRisk = "medium" | "high";

export interface HardRule {
  readonly id: HardRuleId;
  /** Plain-English row for Settings: "Deleting files or folders". */
  readonly title: string;
  /** What the card says when this rule held the request. */
  readonly held: string;
  readonly risk: HardRuleRisk;
}

/** Ordered as Settings lists them. */
export const HARD_RULES: ReadonlyArray<HardRule> = [
  {
    id: "deletes-files",
    title: "Deleting files or folders",
    held: "deletes files or folders",
    risk: "high",
  },
  {
    id: "destructive-git",
    title: "Rewriting or throwing away saved history",
    held: "rewrites or discards saved history",
    risk: "high",
  },
  {
    id: "pushes-to-live",
    title: "Uploading straight to the live version",
    held: "uploads to the live version",
    risk: "high",
  },
  {
    id: "publishes-or-deploys",
    title: "Putting anything live or publishing a package",
    held: "puts something live",
    risk: "high",
  },
  {
    id: "payments",
    title: "Anything that could move money",
    held: "talks to a payments service",
    risk: "high",
  },
  {
    id: "outside-project",
    title: "Changing or running anything outside this project's folder",
    held: "works outside your project folder",
    risk: "high",
  },
  {
    id: "leaves-sandbox",
    title: "Stepping outside the assistant's safe area",
    held: "needs to reach outside the assistant's safe area",
    risk: "medium",
  },
  {
    id: "sends-data-out",
    title: "Copying files to another computer or service",
    held: "sends files to another computer",
    risk: "high",
  },
  {
    id: "pipes-to-shell",
    title: "Running a downloaded script without a look first",
    held: "runs a downloaded script straight away",
    risk: "high",
  },
  {
    id: "destructive-command",
    title: "Known-dangerous commands (wipe, overwrite, reset)",
    held: "is a known-dangerous command",
    risk: "high",
  },
  {
    id: "secrets",
    title: "Touching keys, passwords or secret files",
    held: "touches a secrets file or key",
    risk: "medium",
  },
  {
    id: "reads-outside-project",
    title: "Reading a file outside this project's folder",
    held: "reads a file outside your project",
    risk: "medium",
  },
  {
    id: "connected-app",
    title: "Using a connected app or tool on your behalf",
    held: "uses a connected app",
    risk: "medium",
  },
];

const RULES_BY_ID: ReadonlyMap<HardRuleId, HardRule> = new Map(
  HARD_RULES.map((rule) => [rule.id, rule]),
);

export function hardRule(id: HardRuleId): HardRule {
  return RULES_BY_ID.get(id)!;
}

export interface RuleContext {
  /** The thread's private copy when it has one, else the project folder. */
  readonly projectRoot?: string | null | undefined;
  /** The branch everyone sees, when the engine knows it. */
  readonly defaultBranch?: string | null | undefined;
  /**
   * The branch checked out where the command runs, so a bare `git push` can be judged.
   * Leave it unset when unknown: the push is then held, because the rules cannot tell
   * which branch would go up.
   */
  readonly currentBranch?: string | null | undefined;
}

export interface RuleMatch {
  readonly rule: HardRule;
  /** The token or segment that tripped the rule, for "Show details". */
  readonly detail?: string;
  /** When set, this match carries a different weight than the rule's default. */
  readonly risk?: HardRuleRisk;
  /** When set, the card says this instead of the rule's `held` sentence. */
  readonly held?: string;
}

export type RuleRisk = "low" | "medium" | "high";

export interface RuleEvaluation {
  readonly decision: "allow" | "hold";
  readonly risk: RuleRisk;
  readonly matches: ReadonlyArray<RuleMatch>;
}

function evaluation(matches: ReadonlyArray<RuleMatch>): RuleEvaluation {
  // One match per rule, first detail wins.
  const seen = new Set<HardRuleId>();
  const unique = matches.filter((match) => {
    if (seen.has(match.rule.id)) return false;
    seen.add(match.rule.id);
    return true;
  });
  const risk: RuleRisk = unique.some((m) => (m.risk ?? m.rule.risk) === "high")
    ? "high"
    : unique.length > 0
      ? "medium"
      : "low";
  return { decision: unique.length > 0 ? "hold" : "allow", risk, matches: unique };
}

/**
 * Patterns that mark a whole command as destructive whatever else it does. Kept broad on
 * purpose (SEC-06): obfuscation is normalised first by `normalizeForMatching`.
 */
export const DESTRUCTIVE_ALWAYS_BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+/, // rm -rf / rm -r / rm -f
  /\brm\s+(--recursive|--force|--no-preserve-root)\b/,
  /\brmdir\b.*\/[sS]\b/, // Windows rmdir /s
  /\b(Remove-Item|ri|rd)\b[^|;&]*-(Recurse|Force)\b/i,
  /\bfind\b[^|;&]*\s(-delete|-exec\s+rm)\b/,
  /\bshred\b/,
  /\bgit\s+push\b[^|;&]*(--force\b|-f\b|--force-with-lease\b|\s\+[\w/-]+)/,
  /\bgit\s+push\b[^|;&]*(--delete\b|-d\b|\s:[\w/-]+)/,
  /\bgit\s+push\b[^|;&]*\b(origin|upstream)\s+(main|master|production|prod|release|trunk|live)\b/,
  /\bgit\s+push\b[^|;&]*\bHEAD:(main|master|production|prod|release|trunk|live)\b/,
  /\bgit\s+branch\s+(-D|--delete\s+--force|--force\s+--delete)\b/,
  /\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)|TRUNCATE(\s+TABLE)?)\b/i,
  /\bDELETE\s+FROM\s+[\w."`]+\s*(;|$|'|")(?![\s\S]*\bWHERE\b)/i,
  /\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/,
  /\b(ba|z|da|k)?sh\s+<\(\s*(curl|wget)\b/,
  /\beval\s+["']?\$\(\s*(curl|wget)\b/,
  /\b(stripe|paypal|braintree|adyen)\b.*\b(charge|payment|payout|refund|transfer)s?\b/i,
  /\b(charge|payment|payout|refund|transfer)s?\b.*\b(stripe|paypal|braintree|adyen)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*[fdx]|filter-branch|filter-repo)\b/,
  /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/,
  /\bgit\s+stash\s+(drop|clear)\b/,
  /\b(mkfs|dd\s+if=|:\(\)\s*\{\s*:\|:&\s*\};:)/,
  /\bsudo\s+rm\b/,
  /\bchmod\s+(-R\s+)?777\b/,
  /\baws\s+s3\s+(rm|rb)\b/,
  /\baws\b[^|;&]*\b(delete-[\w-]+|terminate-instances)\b/,
  /\bgcloud\b[^|;&]*\bdelete\b/,
  /\baz\b[^|;&]*\bdelete\b/,
  /\bkubectl\s+delete\b/,
  /\bhelm\s+(uninstall|delete)\b/,
  /\bterraform\s+(destroy|apply)\b/,
  /\bpulumi\s+(destroy|up)\b/,
  /\bcdk\s+destroy\b/,
  /\bdocker\s+(system\s+prune|volume\s+(rm|prune)|rmi|container\s+prune|image\s+prune)\b/,
  /\bdocker\s+compose\s+down\b[^|;&]*(-v|--volumes)\b/,
  /\bprisma\s+(migrate\s+reset|db\s+push\s+--force-reset)\b/,
  /\bsupabase\s+db\s+reset\b/,
  /\brails\s+db:(drop|reset|schema:load)\b/,
  /\b(php\s+artisan\s+migrate:(fresh|reset|refresh))\b/,
  /\bdropdb\b/,
  /\bredis-cli\b[^|;&]*\bFLUSH(ALL|DB)\b/i,
];

/** The whole-command check behind "Known-dangerous commands". */
export function isDestructiveCommand(command: string): boolean {
  const text = normalizeForMatching(unwrapShellWrapper(command));
  return DESTRUCTIVE_ALWAYS_BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

const DELETE_PROGRAMS = new Set([
  "rm",
  "rmdir",
  "del",
  "erase",
  "rd",
  "shred",
  "unlink",
  "trash",
  "trash-put",
  "remove-item",
  "ri",
]);
const READ_PROGRAMS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "tree",
  "stat",
  "file",
  "du",
  "bat",
  "exa",
  "eza",
  "jq",
  "yq",
  "diff",
  "cmp",
  "md5",
  "shasum",
  "sha256sum",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "find",
  "fd",
  "fdfind",
  "awk",
  "sed",
  "sort",
  "uniq",
  "cut",
  "strings",
  "xxd",
  "hexdump",
  "open",
  "code",
]);
const TRANSFER_PROGRAMS = new Set(["scp", "sftp", "ftp", "nc", "ncat", "netcat", "telnet", "ssh"]);
const DEPLOY_PROGRAMS = new Set([
  "vercel",
  "netlify",
  "fly",
  "flyctl",
  "heroku",
  "wrangler",
  "firebase",
  "railway",
  "render",
  "eb",
  "serverless",
  "sls",
  "cdk",
  "pulumi",
  "terraform",
  "kubectl",
  "helm",
  "amplify",
  "sst",
  "eas",
  "fastlane",
]);
/** The same programs when a package manager runs them from `node_modules/.bin`. */
const RUNNABLE_BINS: ReadonlySet<string> = new Set([...DEPLOY_PROGRAMS, "stripe", "twine", "gh"]);
/** `mv page.html page.html.bak`: the page disappears from the site. */
export const RENAMES_AWAY = "renames a file out of the way, so it disappears from the site";
/** The bare `git push` whose checked-out branch nobody could name. */
export const UNKNOWN_BRANCH_PUSH =
  "sends your work online — SKYCOT can't tell which branch this uploads to";
/** `npm run deploy`: a script named like a deploy is one until proven otherwise. */
const DEPLOY_SCRIPT_NAMES =
  /^(deploy|publish|release|ship|promote|prod|production|go-live|golive)(:.*)?$/i;
const DEPLOY_SUBCOMMANDS =
  /^(deploy|publish|release|apply|up|launch|rollout|prod|promote|submit|update|install|upgrade|scale|run|push|alias|ship)$/;
const LIVE_BRANCHES = new Set([
  "main",
  "master",
  "trunk",
  "production",
  "prod",
  "release",
  "live",
  "gh-pages",
]);
const PAYMENT_PROVIDER_PATTERN =
  /\b(stripe|paypal|braintree|adyen|square(up)?|checkout\.com|razorpay|mollie|klarna|afterpay|pin\.?payments|eway|gocardless|wise|xero|myob|quickbooks)\b/i;
const PAYMENT_ACTION_PATTERN =
  /\b(charge|payment|payout|refund|transfer|invoice|subscription|price|checkout|customer|balance|order|capture|dispute)s?\b/i;
const SECRET_VARIABLE_PATTERN =
  /\$\{?\w*(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY)\w*\}?/i;
const SECRET_TOOL_PATTERN =
  /\b(security\s+find-(generic|internet)-password|gh\s+auth\s+token|op\s+(read|item\s+get)|vault\s+(read|kv\s+get)|aws\s+(configure|sts\s+get-session-token)|gcloud\s+auth\s+print-access-token|az\s+account\s+get-access-token|keytool|ssh-keygen|gpg\s+--export-secret)/i;
const UPLOAD_FLAG_PATTERN =
  /(^|\s)(-T|--upload-file|--data-binary\s+@|--data\s+@|-d\s+@|--data-raw\s+@|-F\s+\S*@|--form\s+\S*@|--post-file|--post-data|--body-file)/;

function isPathLike(token: string): boolean {
  if (token.includes("://") || token.startsWith("-")) return false;
  return (
    token.startsWith("/") ||
    token.startsWith("~") ||
    token.startsWith("$HOME") ||
    token.startsWith("${HOME}") ||
    /^[A-Za-z]:\\/.test(token) ||
    /(^|[\\/])\.\.([\\/]|$)/.test(token)
  );
}

function pathTokens(args: ReadonlyArray<string>): Array<string> {
  return args
    .flatMap((arg) => {
      // `--output=/x`, `key=/x`, `>/x`, `2>/x`
      const eq = arg.indexOf("=");
      if (eq > 0 && !arg.startsWith("/")) return [arg.slice(eq + 1)];
      return [arg.replace(/^\d*>{1,2}/, "")];
    })
    .filter((candidate) => candidate.length > 0 && isPathLike(candidate));
}

function hasRemoteTarget(args: ReadonlyArray<string>): boolean {
  return args.some(
    (arg) =>
      !arg.startsWith("-") &&
      (arg.startsWith("rsync://") ||
        /^[\w.-]+@[\w.-]+:/.test(arg) ||
        /^[\w.-]+\.[a-z]{2,}:/i.test(arg)),
  );
}

function evaluateSegment(segment: string, ctx: RuleContext): Array<RuleMatch> {
  // `sh -c "a && b"`: every command inside is judged, not only the first.
  const inner = innerShellScript(segment);
  if (inner !== null) {
    return splitShellSegments(normalizeForMatching(inner)).flatMap((part) =>
      evaluateSegment(part, ctx),
    );
  }
  const matches: Array<RuleMatch> = [];
  const hit = (id: HardRuleId, detail: string = segment) =>
    matches.push({ rule: hardRule(id), detail });
  const tokens = programTokens(segment, { bins: RUNNABLE_BINS });
  const program = tokens[0];
  // `> file` or `: > file` on its own empties the file.
  if (program === undefined || program === ">" || program === ":") {
    if (/^:?\s*>\s*\S+/.test(segment)) hit("deletes-files");
    return matches;
  }
  const base = programBaseName(program).toLowerCase();
  const args = tokens.slice(1);
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const sub = positional[0]?.toLowerCase() ?? "";

  // Deleting.
  if (DELETE_PROGRAMS.has(base)) hit("deletes-files");
  if (base === "find" && args.some((arg) => arg === "-delete" || arg === "-exec")) {
    if (args.some((arg) => arg === "-delete") || /-exec\s+rm\b/.test(segment)) hit("deletes-files");
  }
  if (base === "git" && (sub === "rm" || sub === "clean")) hit("deletes-files");
  // `mv book.html book.html.bak`: the page leaves the site just as if it were deleted.
  const moved =
    base === "mv" ? positional : base === "git" && sub === "mv" ? positional.slice(1) : [];
  if (moved.length >= 2) {
    const target = programBaseName(moved.at(-1)!);
    const sources = moved.slice(0, -1);
    if (
      /\.(bak|old|orig|backup|tmp|disabled)$|~$|^\./i.test(target) &&
      sources.some((source) => !/\.(bak|old|orig|backup|tmp|disabled)$|~$/i.test(source))
    ) {
      matches.push({
        rule: hardRule("deletes-files"),
        detail: segment,
        risk: "medium",
        held: RENAMES_AWAY,
      });
    }
  }

  // History.
  if (base === "git") {
    if (
      /\b(reset\s+--hard|filter-branch|filter-repo)\b/.test(segment) ||
      (sub === "clean" && /\s-[a-zA-Z]*[fdx]/.test(segment)) ||
      (sub === "branch" && /\s(-D|--delete\s+--force|--force\s+--delete)\b/.test(segment)) ||
      (sub === "push" &&
        /(--force\b|\s-f\b|--force-with-lease\b|\s\+[\w/-]+|--delete\b|\s-d\b|\s:[\w/-]+)/.test(
          segment,
        )) ||
      (sub === "stash" && /\b(drop|clear)\b/.test(segment)) ||
      ((sub === "checkout" || sub === "restore") && /\s(--\s+)?\.(\s|$)/.test(segment))
    ) {
      hit("destructive-git");
    }
    if (sub === "push") {
      const live = new Set(LIVE_BRANCHES);
      if (ctx.defaultBranch) live.add(ctx.defaultBranch);
      if (args.some((arg) => arg === "--all" || arg === "--mirror" || arg === "--branches")) {
        hit("pushes-to-live");
      }
      // `git push <remote> <ref>…`; `HEAD:main` and `+main` name the far side.
      const refs = positional.slice(2).filter((ref) => !/^--?\w/.test(ref));
      const farSide = (ref: string) => {
        const target = ref.replace(/^\+/, "").replace(/^.*:/, "");
        return target === "HEAD" || target === "" ? null : target;
      };
      const named = refs.map(farSide);
      if (named.some((ref) => ref !== null && live.has(ref))) hit("pushes-to-live");
      // No far-side name (`git push`, `git push origin`, `git push origin HEAD`): the
      // checked-out branch goes up. Judge it, or hold when nobody knows which it is.
      if (named.every((ref) => ref === null)) {
        const current = ctx.currentBranch ?? null;
        if (current === null) {
          matches.push({
            rule: hardRule("pushes-to-live"),
            detail: `${segment} (current branch unknown)`,
            risk: "medium",
            held: UNKNOWN_BRANCH_PUSH,
          });
        } else if (live.has(current)) {
          hit("pushes-to-live", `${segment} (on ${current})`);
        }
      }
    }
  }
  if (base === "gh" && /^pr\s+merge\b/.test(positional.join(" "))) hit("pushes-to-live");
  if (base === "glab" && /^mr\s+merge\b/.test(positional.join(" "))) hit("pushes-to-live");

  // Publishing and deploying.
  if (DEPLOY_PROGRAMS.has(base)) {
    const deploys = sub === "" || DEPLOY_SUBCOMMANDS.test(sub) || args.includes("--prod");
    if (deploys) hit("publishes-or-deploys");
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(base)) {
    // `npm run deploy`, `yarn deploy`, `yarn npm publish` (Yarn Berry).
    const script =
      sub === "run" || sub === "run-script" ? positional[1] : base === "npm" ? undefined : sub;
    if (script !== undefined && DEPLOY_SCRIPT_NAMES.test(script)) hit("publishes-or-deploys");
    if (base === "yarn" && sub === "npm" && positional[1] === "publish")
      hit("publishes-or-deploys");
  }
  if (
    (["npm", "pnpm", "yarn", "bun"].includes(base) &&
      /^(publish|deprecate|unpublish|dist-tag)$/.test(sub)) ||
    (base === "cargo" && sub === "publish") ||
    (base === "gem" && sub === "push") ||
    (base === "twine" && sub === "upload") ||
    (base === "docker" && sub === "push") ||
    (base === "gh" && /^release\s+(create|upload|edit|delete)\b/.test(positional.join(" "))) ||
    (base === "aws" &&
      /\b(deploy|create-stack|update-stack|update-function-code|put-object|sync)\b/.test(
        segment,
      )) ||
    (base === "gcloud" && /\b(deploy|run\s+deploy|functions\s+deploy)\b/.test(segment)) ||
    (base === "az" && /\b(deploy|webapp\s+up|functionapp\s+publish)\b/.test(segment)) ||
    (base === "shopify" && /\btheme\s+push\b/.test(segment)) ||
    (base === "xcrun" && /\baltool\b[^|;&]*--upload/.test(segment))
  ) {
    hit("publishes-or-deploys");
  }

  // Money.
  if (
    PAYMENT_PROVIDER_PATTERN.test(segment) &&
    (PAYMENT_ACTION_PATTERN.test(segment) ||
      base === "stripe" ||
      /api\.(stripe|paypal)\.com/i.test(segment))
  ) {
    hit("payments");
  }

  // Sending things out.
  if (TRANSFER_PROGRAMS.has(base)) hit("sends-data-out");
  if (base === "rsync" && hasRemoteTarget(args)) hit("sends-data-out");
  if (
    (base === "curl" ||
      base === "wget" ||
      base === "http" ||
      base === "https" ||
      base === "httpie") &&
    UPLOAD_FLAG_PATTERN.test(segment)
  ) {
    hit("sends-data-out");
  }
  if (
    base === "aws" &&
    /^s3\s+(cp|sync|mv)\b/.test(positional.join(" ")) &&
    /\ss3:\/\//.test(segment)
  ) {
    hit("sends-data-out");
  }
  if (base === "gsutil" && /^(cp|rsync|mv)\b/.test(sub) && /\sgs:\/\//.test(segment))
    hit("sends-data-out");
  if (base === "gh" && /^gist\s+create\b/.test(positional.join(" "))) hit("sends-data-out");

  // Secrets.
  if (SECRET_VARIABLE_PATTERN.test(segment) || SECRET_TOOL_PATTERN.test(segment)) hit("secrets");
  for (const arg of positional) {
    if (isSecretPath(arg)) {
      hit("secrets", arg);
      break;
    }
  }

  // Outside the project.
  const outside = [...(base === "cd" ? positional.slice(0, 1) : []), ...pathTokens(args)].filter(
    (candidate) => isOutsideProject(candidate, ctx.projectRoot),
  );
  if (outside.length > 0) {
    hit(READ_PROGRAMS.has(base) ? "reads-outside-project" : "outside-project", outside[0]!);
  }

  return matches;
}

/** Judge one shell command against every hard rule. */
export function evaluateCommand(command: string, ctx: RuleContext = {}): RuleEvaluation {
  const unwrapped = unwrapShellWrapper(command.trim());
  const text = normalizeForMatching(unwrapped);
  const matches: Array<RuleMatch> = [];
  if (isDestructiveCommand(text))
    matches.push({ rule: hardRule("destructive-command"), detail: command.trim() });
  if (
    /\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(text) ||
    /\b(ba|z|da|k)?sh\s+<\(/.test(text) ||
    /\beval\s+["']?\$\(/.test(text)
  ) {
    matches.push({ rule: hardRule("pipes-to-shell"), detail: command.trim() });
  }
  for (const segment of splitShellSegments(text)) matches.push(...evaluateSegment(segment, ctx));
  // `x=$(npx vercel --prod)`, `` echo `wrangler deploy` ``: what runs inside counts too.
  for (const inner of commandSubstitutions(text)) {
    for (const segment of splitShellSegments(inner)) matches.push(...evaluateSegment(segment, ctx));
  }
  // Everything a destructive pattern catches also counts as deleting or rewriting where that
  // is what it does, so the card can say the specific thing.
  return evaluation(matches);
}

export type RuleFile = PromptFile;

/** Judge a file edit/create/delete request. */
export function evaluateFileChange(
  files: ReadonlyArray<RuleFile>,
  ctx: RuleContext = {},
): RuleEvaluation {
  const matches: Array<RuleMatch> = [];
  for (const file of files) {
    if (file.operation === "remove")
      matches.push({ rule: hardRule("deletes-files"), detail: file.path });
    if (isOutsideProject(file.path, ctx.projectRoot)) {
      matches.push({ rule: hardRule("outside-project"), detail: file.path });
    }
    if (isSecretPath(file.path)) matches.push({ rule: hardRule("secrets"), detail: file.path });
  }
  return evaluation(matches);
}

/** Judge a file read request. */
export function evaluateFileRead(
  files: ReadonlyArray<RuleFile>,
  ctx: RuleContext = {},
): RuleEvaluation {
  const matches: Array<RuleMatch> = [];
  for (const file of files) {
    if (isOutsideProject(file.path, ctx.projectRoot)) {
      matches.push({ rule: hardRule("reads-outside-project"), detail: file.path });
    }
    if (isSecretPath(file.path)) matches.push({ rule: hardRule("secrets"), detail: file.path });
  }
  return evaluation(matches);
}

export type RuleRequestKind =
  | "command"
  | "file-change"
  | "file-read"
  | "permission"
  | "mcp-elicitation";

export interface RuleRequest {
  readonly kind: RuleRequestKind;
  /** The exact command text for `command` requests. */
  readonly command?: string | undefined;
  /** The files for `file-change` / `file-read` requests. */
  readonly files?: ReadonlyArray<RuleFile> | undefined;
  /** The provider asked to run this command outside its sandbox (see `readCommandAsk`). */
  readonly leavesSandbox?: boolean | undefined;
  /** The provider's own words for why, when it gave any. */
  readonly sandboxReason?: string | undefined;
}

/** The card's one-line explanation of the sandbox, in words a non-developer can follow. */
export const SANDBOX_EXPLAINER =
  "The assistant normally works inside a walled-off area of your Mac. This step needs to reach outside it.";

/**
 * Adds the "leaves the sandbox" hold to whatever else the command matched. On its own it is a
 * question (medium); on top of another rule the step is already risky and now unconfined (high).
 */
export function withLeavesSandbox(base: RuleEvaluation, detail?: string): RuleEvaluation {
  return evaluation([
    {
      rule: hardRule("leaves-sandbox"),
      ...(detail === undefined ? {} : { detail }),
      risk: base.matches.length > 0 ? "high" : "medium",
    },
    ...base.matches,
  ]);
}

export interface CommandAsk {
  /** The provider that asked (`codex`, `claudeAgent`, …), from the approval's native item. */
  readonly driver?: string | null | undefined;
  /** The approval item's prompt. */
  readonly prompt?: string | undefined;
  /** The tool call's own command text, when its item is stored. */
  readonly toolCallInput?: string | undefined;
}

export interface CommandAskFacts {
  /** The command that would run; undefined when nobody can tell. */
  readonly command: string | undefined;
  readonly leavesSandbox: boolean;
  readonly sandboxReason?: string;
}

function nonEmpty(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/** "Allow Git to push this branch …?": a sentence for a person, not a command line. */
function looksLikeReason(text: string): boolean {
  return /\?$/.test(text) || /^[A-Z][a-z]+(\s+[\w'’,.-]+){3,}[.!]?$/.test(text);
}

/**
 * Whether a Codex prompt is (part of) the command itself. Codex shows `reason ?? command`, and
 * a subcommand ask (zsh exec bridge) shows one piece of the script, so any piece of the
 * command counts as the command. Erring towards "a reason" only costs a question.
 */
function promptIsCommand(prompt: string, command: string): boolean {
  if (command.includes(prompt)) return true;
  const flat = (text: string) =>
    normalizeForMatching(unwrapShellWrapper(text)).replace(/\s+/g, " ");
  return flat(command).includes(flat(prompt));
}

/**
 * Reads a command ask the way its provider phrases it. Codex puts the reason in the prompt
 * only when the command must leave the sandbox (the model's escalation justification, or
 * "retry without sandbox?" after a sandbox denial); an ordinary ask shows the command itself.
 * Claude's prompt is a human title and SKYCOT does not run Claude inside its sandbox, so
 * nothing Claude asks is an escalation.
 */
export function readCommandAsk(ask: CommandAsk): CommandAskFacts {
  const input = nonEmpty(ask.toolCallInput);
  const prompt = nonEmpty(ask.prompt);
  if (ask.driver !== "codex") return { command: input ?? prompt, leavesSandbox: false };
  if (input === undefined) {
    return prompt !== undefined && looksLikeReason(prompt)
      ? { command: undefined, leavesSandbox: true, sandboxReason: prompt }
      : { command: prompt, leavesSandbox: false };
  }
  if (prompt === undefined || promptIsCommand(prompt, input)) {
    return { command: input, leavesSandbox: false };
  }
  return { command: input, leavesSandbox: true, sandboxReason: prompt };
}

/**
 * The single entry point both sides use. Unknown or unreadable requests are held: a rule
 * engine that cannot see what it is judging must not say yes.
 */
export function evaluateRequest(request: RuleRequest, ctx: RuleContext = {}): RuleEvaluation {
  switch (request.kind) {
    case "command": {
      const base =
        request.command === undefined || request.command.trim().length === 0
          ? evaluation([
              { rule: hardRule("destructive-command"), detail: "command text unavailable" },
            ])
          : evaluateCommand(request.command, ctx);
      return request.leavesSandbox === true
        ? withLeavesSandbox(base, request.sandboxReason ?? request.command)
        : base;
    }
    case "file-change":
      return request.files === undefined || request.files.length === 0
        ? evaluation([{ rule: hardRule("outside-project"), detail: "file list unavailable" }])
        : evaluateFileChange(request.files, ctx);
    case "file-read":
      return request.files === undefined || request.files.length === 0
        ? evaluation([{ rule: hardRule("reads-outside-project"), detail: "file list unavailable" }])
        : evaluateFileRead(request.files, ctx);
    case "permission":
    case "mcp-elicitation":
      return evaluation([{ rule: hardRule("connected-app") }]);
  }
}

/** "deletes files or folders and works outside your project folder" */
export function describeMatches(matches: ReadonlyArray<RuleMatch>): string {
  const parts = matches.map((match) => match.held ?? match.rule.held);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
