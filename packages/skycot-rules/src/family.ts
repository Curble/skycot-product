// nondev-seam: skycot-rules-package
// The Family profile's extra rules. On top of the hard rules (which already hold deleting,
// leaving the project, publishing and secrets), a child's assistant must not reach the
// internet or install anything without a grown-up. A request any of these match needs the
// parent code before it can be allowed; the server refuses the "Allow" otherwise, and the
// card says "Ask a grown-up". Pure functions over strings, shared by server and client.

import { addOnAskOf, isTrustedAddOnAsk } from "./addons.ts";
import {
  evaluateRequest,
  type HardRuleId,
  type RuleContext,
  type RuleEvaluation,
  type RuleRequest,
} from "./rules.ts";
import {
  commandSubstitutions,
  fileWriteTargets,
  innerShellScript,
  normalizeForMatching,
  programBaseName,
  programTokens,
  splitShellSegments,
  tokenize,
  unwrapShellWrapper,
} from "./shell.ts";

export type FamilyRuleId = "uses-internet" | "installs-software" | "admin-rights" | "opaque-code";

// nondev-seam: skycot-project-approval-covers
/** The only kinds a grown-up may let a child use without asking again for this project. */
export const PROJECT_APPROVAL_COVERS = [
  "webSearch",
  "addOns",
  "internetFetch",
  "internetAssets",
] as const;
export type ProjectApprovalCover = (typeof PROJECT_APPROVAL_COVERS)[number];

// nondev-seam: skycot-project-approval-covers
/** Only a simple, held internet or add-on request can offer a project yes. */
export function projectApprovalCoverFor(
  request: FamilyRequest,
  evaluation: FamilyEvaluation,
  ctx: FamilyContext = {},
): ProjectApprovalCover | null {
  if (!evaluation.needsGrownUp) return null;
  if (request.toolItemType === "web_search") {
    return evaluation.base.decision === "hold" ? null : "webSearch";
  }
  if (request.kind !== "command" || request.command === undefined) return null;
  const projectCommand = commandForProjectCover(request.command, ctx.projectRoot);
  const ids = new Set(evaluation.family.map((match) => match.rule.id));
  if (
    ids.has("installs-software") &&
    addOnAskOf(projectCommand)?.names.length &&
    [...ids].every((id) => id === "uses-internet" || id === "installs-software") &&
    evaluation.base.matches.every((match) => match.rule.id === "leaves-sandbox")
  )
    return "addOns";
  if (evaluation.base.decision === "hold") return null;
  if (ids.size === 1 && ids.has("uses-internet") && isSimpleHttpsFetch(projectCommand)) {
    return "internetFetch";
  }
  return null;
}

// nondev-seam: skycot-project-approval-covers
/**
 * Pure: a plain `curl` or `wget` of one https address, optionally saving to a file inside the
 * project (a font or picture a page wants): no pipes, no quotes, no other options with values.
 */
export function isSimpleHttpsFetch(command: string): boolean {
  const tokens = tokenize(command.trim());
  if (tokens.length < 2 || !/^(?:curl|wget)$/iu.test(tokens[0]!)) return false;
  const isWget = /^wget$/iu.test(tokens[0]!);
  const plainFlag = /^-(?:[fLsSfqO]+|-location|-silent|-fail|-show-error)$/u;
  const inside = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;
  const address =
    /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~%!$&'()*+,=:@/-]*)?(?:\?[A-Za-z0-9._~%!$&()*+,=:@/?-]*)?$/u;
  let urls = 0;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (address.test(token)) {
      urls += 1;
    } else if (token === "-o" || token === "--output" || (isWget && token === "-O")) {
      const target = tokens[i + 1];
      if (target === undefined || !inside.test(target) || target.split("/").includes("..")) {
        return false;
      }
      i += 1;
    } else if (plainFlag.test(token)) {
      continue;
    } else if (
      /^--(?:max-time|connect-timeout|retry)$/u.test(token) &&
      /^\d{1,3}$/u.test(tokens[i + 1] ?? "")
    ) {
      i += 1;
    } else {
      return false;
    }
  }
  if (urls !== 1) return false;
  // Pictures, sounds, fonts and plain data only: code from the internet (.js, .html, .sh, ...)
  // stays a grown-up's call each time, because the page would then run it.
  const named = tokens.find(
    (_, i) =>
      tokens[i - 1] === "-o" || tokens[i - 1] === "--output" || (isWget && tokens[i - 1] === "-O"),
  );
  const fromAddress = tokens.find((token) => token.startsWith("https://"))!.split(/[?#]/u)[0]!;
  const file = (named ?? fromAddress.split("/").at(-1) ?? "").toLowerCase();
  return /\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico|mp3|wav|ogg|m4a|json|txt|csv)$/u.test(
    file,
  );
}

/** Peel only shell forms that keep a single, plain command inside the project. */
function commandForProjectCover(command: string, projectRoot?: string | null): string {
  const unwrapped = unwrapShellWrapper(command.trim());
  if (/[|;<>`$()\n]/u.test(unwrapped)) return "";
  const segments = unwrapped.split(/\s+&&\s+/u);
  if (segments.length === 1) return segments[0]!.trim();
  if (segments.length > 3) return "";
  let index = 0;
  for (; index < segments.length - 1; index += 1) {
    const words = tokenize(segments[index]!);
    if (
      words.length === 2 &&
      words[0] === "cd" &&
      (safeProjectFolder(words[1]!) || safeAbsoluteProjectFolder(words[1]!, projectRoot))
    )
      continue;
    if (
      words.length === 3 &&
      words[0] === "mkdir" &&
      words[1] === "-p" &&
      safeProjectFolder(words[2]!)
    )
      continue;
    return "";
  }
  return segments.at(-1)!.trim();
}

function safeAbsoluteProjectFolder(folder: string, projectRoot?: string | null): boolean {
  if (projectRoot === null || projectRoot === undefined || !folder.startsWith("/")) return false;
  const root = projectRoot.replace(/\/+$/u, "");
  const target = folder.replace(/\/+$/u, "");
  return target === root || target.startsWith(`${root}/`);
}

function safeProjectFolder(folder: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(folder) &&
    !folder.split("/").some((part) => part === "." || part === "..")
  );
}

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
    id: "opaque-code",
    title: "Code SKYCOT can't read",
    held: "SKYCOT can't read exactly what this does",
  },
  {
    id: "admin-rights",
    title: "Changing how the Mac itself is set up",
    held: "changes how the Mac is set up",
  },
];

export interface FamilyMatch {
  readonly rule: FamilyRule;
  readonly detail?: string;
  /**
   * Inline code that reaches files, the system or other programs. An offline sandbox does not
   * contain it (Codex's still lets it read the whole Mac), so it always waits for a grown-up.
   */
  readonly reachesComputer?: true;
}

export interface FamilyRequest extends RuleRequest {
  /**
   * The tool call's turn-item type when known. `web_search` is how both Claude's WebFetch /
   * WebSearch and Codex's web search arrive, so it is the internet whatever the prompt says.
   */
  readonly toolItemType?: string | undefined;
}

/**
 * Why a step that would need a grown-up is the child's after all (beta 5, "make it more
 * seamless"): a trusted add-on SKYCOT fetches itself, an add-on a grown-up already said yes to
 * in this conversation, or a delete inside the project that a restore point can undo.
 */
export type FamilyRelief = "trusted-add-on" | "approved-before" | "undoable-delete";

/** What the engine knows about the conversation beyond its folders. Unknown: no relief. */
export interface FamilyContext extends RuleContext {
  /**
   * SKYCOT itself does an accepted add-on install or download for this conversation (Codex:
   * SkycotApprovedInstalls), so the assistant's own command never runs. Without it no add-on
   * is relieved: the assistant's own install would run, scripts and all.
   */
  readonly skycotFetchesAddOns?: boolean | undefined;
  /** The parent's "Trusted add-ons download by themselves" (on unless they turned it off). */
  readonly trustedAddOns?: boolean | undefined;
  /** Add-on names a grown-up already said yes to in this conversation (unexpired). */
  readonly approvedAddOns?: ReadonlyArray<string> | undefined;
  /** The conversation's folder keeps versions (SKYCOT restore points), so a delete can be undone. */
  readonly keepsVersions?: boolean | undefined;
}

export interface FamilyEvaluation {
  /** True when only a grown-up may allow this request. */
  readonly needsGrownUp: boolean;
  /** The ordinary hard-rule evaluation (its holds count too). Allow-clean when relieved. */
  readonly base: RuleEvaluation;
  readonly family: ReadonlyArray<FamilyMatch>;
  /** Set when a rule would have held it but a relief makes it the child's step. */
  readonly relief?: FamilyRelief;
  /** The add-ons a relieved add-on ask names ("three"). */
  readonly addOns?: ReadonlyArray<string>;
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
/** git sub-commands that only work on this computer: a web address in them is text. */
const GIT_LOCAL_SUBCOMMANDS =
  /^(add|commit|status|log|diff|show|grep|blame|branch|checkout|switch|restore|reset|stash|tag|merge|rebase|cherry-pick|revert|config|init|mv|rm|notes|describe|shortlog|rev-parse|ls-files|reflog|clean)$/;
const URL_PATTERN = /\b(?:https?|ftp|wss?):\/\/|\bgit@[\w.-]+:/i;

// ── Mentioning a web address is not using the internet ────────────────────────────────
// A web address only reaches the internet when something goes there with it. `grep -r
// "https://" .` looks for the text, `echo "see https://x"` prints it and `cat > check.js
// <<'EOF' … EOF` writes it into a file; none of them leave the computer. So a web address
// is judged by what holds it: a program that only prints, searches or writes text on this
// computer is fine, inline JavaScript or Python is judged by whether it calls the network,
// and anything else with a web address still needs a grown-up. When in doubt, it holds:
// letting the internet through by mistake is worse than asking once too often.

/**
 * Programs that only print, search, sort or write text on this computer. A web address in
 * their words is a pattern to look for or text to print, never a place they go.
 */
const TEXT_PROGRAMS = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "echo",
  "printf",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "sed",
  "awk",
  "gawk",
  "mawk",
  "nawk",
  "diff",
  "cmp",
  "comm",
  "jq",
  "tee",
  "test",
  "[",
  "[[",
  "true",
  "false",
  ":",
  "touch",
  "mkdir",
  "basename",
  "dirname",
  "column",
  "fold",
  "nl",
  "rev",
  "paste",
  "strings",
  "ls",
  "find",
  "stat",
  "file",
  "md5",
  "md5sum",
  "shasum",
  "sha256sum",
  "expr",
]);
const SHELL_PROGRAM = /^(ba|z|da|k|fi)?sh$/;
const JS_RUNTIMES = new Set(["node", "nodejs", "bun", "deno"]);
const PYTHON_PROGRAM = /^python(\d+(\.\d+)?)?$/;
const OTHER_INTERPRETERS = new Set([
  "ruby",
  "irb",
  "perl",
  "php",
  "lua",
  "rscript",
  "tclsh",
  "pwsh",
  "powershell",
  "osascript",
]);
/** Words that turn the text handed to them into commands: `| xargs`, `while read`, `eval`. */
const CODE_SINKS = new Set([
  "eval",
  "source",
  ".",
  "xargs",
  "parallel",
  "read",
  "mapfile",
  "readarray",
]);
/** Leading shell words in front of the real program: `if curl …`, `while read u`, `! grep`. */
const LEADING_CONTROL = /^(?:if|elif|while|until|then|do|else|!|\{|\()\s+/;
/** Network calls in other languages' one-liners (`ruby -e`, `perl -e`, `php -r`). */
const OTHER_NETWORK_CODE =
  /net\/http|Net::HTTP|open-uri|URI\.open|TCPSocket|\bSocket\b|LWP|HTTP::Tiny|IO::Socket|\bcurl_|fsockopen|file_get_contents|stream_socket|socket\.http|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b|WebClient/i;

type Language = "js" | "python";
type RunnerKind = Language | "shell" | "other";

/** Node modules (and npm packages) that talk to another computer. */
const JS_NETWORK_MODULES =
  "https?|http2|net|tls|dgram|dns|undici|axios|node-fetch|cross-fetch|isomorphic-fetch|got|ky|request|superagent|needle|ws|socket\\.io-client|ftp|basic-ftp|ssh2|nodemailer|open|puppeteer|playwright";
const JS_NETWORK = new RegExp(
  [
    // Any mention of `fetch` as code, so `const get = fetch; get(u)` counts too.
    String.raw`\bfetch\b`,
    String.raw`\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b`,
    String.raw`\b(?:https?|http2|net|tls|dgram|dns)\s*\.\s*(?:get|request|connect|createConnection|lookup|resolve\w*)\s*\(`,
    String.raw`(?:\brequire\s*\(|\bfrom\s+|\bimport\s+)\s*['"\x60](?:node:)?(?:${JS_NETWORK_MODULES})(?:\/[^'"\x60]*)?['"\x60]`,
    String.raw`(?:\brequire\s*\(|\bfrom\s+|\bimport\s+)\s*['"\x60](?:https?|npm|jsr):`,
    String.raw`\b(?:Bun|Deno)\s*\.\s*(?:connect|connectTls|listen|listenTls|serve|resolveDns|startTls)\b`,
  ].join("|"),
);
/** Code that hides what it calls (`eval`, building a name, loading a module by variable). */
const JS_OPAQUE =
  /\beval\s*\(|\bFunction\s*\(|\batob\s*\(|\bfromCharCode\b|['"\x60]base64['"\x60]|\bimport\s*\(|\brequire\s*\((?!\s*(['"\x60])[^'"\x60]*\1\s*\))|\b(?:globalThis|global|window|self|process)\s*\[|\bprocess\s*\.\s*(?:binding|dlopen)\b|['"\x60](?:node:)?vm['"\x60]|\bmodule\s*\.\s*constructor\b|\bWebAssembly\b|(?<![\w$.])vm\s*\./;
/** Code that starts another program, which is then judged as a command. */
const JS_SPAWN =
  /\bchild_process\b|\b(?:execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(|(?<!\.)\bexec\s*\(|\b(?:Bun|Deno)\s*\.\s*(?:spawn|spawnSync|run|Command|\$)|(?:^|[^\w$])\$\s*\x60/;

// ── Inline code that touches this computer ────────────────────────────────────────────
// `node -e "require('fs').unlinkSync(…)"` deletes a file the hard rules never see: the path is
// inside the script, not a word of the command. In the Family profile Claude runs inside an
// OS sandbox that keeps every command in the project whatever it says (SkycotFamilyClaude),
// and Codex in its own; this is the second line. A one-liner may compute and print; one that
// reaches files, the operating system or other programs is code SKYCOT can't vouch for. These
// are allowlists, so a module nobody thought of holds too. A script file the project runs
// (`node build.js`) is not inline code: the sandbox is what keeps that one in the project.

/** Node modules that only compute. `node -e` also has every other built-in as a global. */
const JS_PURE_MODULES = new Set([
  "assert",
  "buffer",
  "crypto",
  "events",
  "path",
  "punycode",
  "querystring",
  "string_decoder",
  "url",
  "util",
]);
/**
 * Built-ins that reach files, the system or other programs, usable as bare globals in `-e`.
 * `vm` is not one: it only runs code, and is already code SKYCOT can't read (`JS_OPAQUE`).
 */
const JS_SYSTEM_GLOBALS =
  /(?<![\w$.])(?:fs|os|child_process|cluster|module|repl|v8|worker_threads|inspector|wasi|tty|sys|trace_events|domain|perf_hooks|stream|zlib|dgram|net|tls|http2?|https|dns|process|require|Deno|Bun)(?![\w$])/g;
/** What a one-liner may use of `process`: its own input, output, arguments and version. */
const JS_PURE_PROCESS =
  /^process\s*\.\s*(?:stdin|stdout|stderr|argv|version|versions|platform|arch|exit|exitCode|hrtime|nextTick|uptime|memoryUsage)\b/;
/** Python modules that only compute. */
const PY_PURE_MODULES = new Set([
  "math",
  "cmath",
  "json",
  "random",
  "re",
  "string",
  "itertools",
  "functools",
  "collections",
  "statistics",
  "decimal",
  "fractions",
  "datetime",
  "time",
  "calendar",
  "textwrap",
  "unicodedata",
  "hashlib",
  "uuid",
  "operator",
  "typing",
  "dataclasses",
  "enum",
  "pprint",
  "sys",
  "array",
  "bisect",
  "heapq",
  "copy",
  "numbers",
  "secrets",
]);
/** Python built-ins that open files or hand control to something else. */
const PY_SYSTEM_BUILTINS = /(?<![\w.])(?:open|file|execfile|breakpoint|help)\s*\(/;
/** Code put together by the shell (`node -e "$(cat x.js)"`, `python3 -c "$CODE"`). */
const SHELL_BUILT_CODE = /\$\(|^\s*\$\{?[A-Za-z_]\w*\}?\s*$/;

/** Modules that compute only, or (`vm`) that `JS_OPAQUE` already holds as unreadable code. */
function isPureJsModule(name: string): boolean {
  const bare = name.replace(/^node:/, "").split("/")[0]!;
  return JS_PURE_MODULES.has(bare) || bare === "vm";
}

/** The code with its '…' and "…" strings emptied, so a word in a message is not code. */
function withoutPlainStrings(code: string): string {
  return code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** Does this inline JavaScript reach files, the operating system or other programs? */
function jsTouchesSystem(code: string): boolean {
  if (SHELL_BUILT_CODE.test(code)) return true;
  for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*(['"\x60])([^'"\x60]*)\1/g)) {
    if (!isPureJsModule(match[2]!)) return true;
  }
  // Every `require` must be a plain call naming a module that only computes: `const r =
  // require; r('fs')` and `require.main` hold. The word inside a message holds too, on purpose.
  for (const match of code.matchAll(/\brequire\b/g)) {
    const call = /^require\s*\(\s*(['"\x60])([^'"\x60]*)\1\s*\)/.exec(code.slice(match.index));
    if (call === null || !isPureJsModule(call[2]!)) return true;
  }
  const bare = withoutPlainStrings(code);
  for (const match of bare.matchAll(JS_SYSTEM_GLOBALS)) {
    if (match[0] === "require") continue;
    if (match[0] === "process" && JS_PURE_PROCESS.test(bare.slice(match.index))) continue;
    return true;
  }
  return false;
}

/** Does this inline Python reach files, the operating system or other programs? */
function pythonTouchesSystem(code: string): boolean {
  if (SHELL_BUILT_CODE.test(code)) return true;
  if (pythonImports(code).some((name) => !PY_PURE_MODULES.has(name))) return true;
  return PY_SYSTEM_BUILTINS.test(withoutPlainStrings(code));
}

const PY_NETWORK_MODULES = new Set([
  "urllib",
  "urllib2",
  "urllib3",
  "requests",
  "httpx",
  "aiohttp",
  "http",
  "httplib",
  "httplib2",
  "socket",
  "socketserver",
  "ssl",
  "ftplib",
  "smtplib",
  "poplib",
  "imaplib",
  "nntplib",
  "telnetlib",
  "xmlrpc",
  "websocket",
  "websockets",
  "paramiko",
  "asyncssh",
  "pycurl",
  "webbrowser",
  "twisted",
  "tornado",
  "grpc",
  "boto3",
  "botocore",
  "mechanize",
  "selenium",
  "playwright",
  "scrapy",
  "pip",
  "ensurepip",
]);
const PY_SPAWN_MODULES = new Set(["subprocess", "pty", "commands"]);
const PY_NETWORK_CALLS = /\b(?:open_connection|create_connection|start_server)\b/;
const PY_OPAQUE =
  /\b__import__\b|\bimportlib\b|\bexec\s*\(|\beval\s*\(|(?<!\.)\bcompile\s*\(|\bgetattr\s*\(|\bbase64\b|\bcodecs\b|\bmarshal\b|\bpickle\b|\bctypes\b|\b__builtins__\b|\bsys\s*\.\s*modules\b|\bglobals\s*\(\s*\)\s*\[/;
const PY_SPAWN =
  /\bos\s*\.\s*(?:system|popen|exec\w*|spawn\w*|posix_spawn\w*)\b|\bcreate_subprocess\w*/;

/** The modules a Python snippet imports: `import a.b as c, d` and `from a.b import x`. */
function pythonImports(code: string): Array<string> {
  const roots: Array<string> = [];
  for (const match of code.matchAll(
    /\bimport\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/g,
  )) {
    for (const part of match[1]!.split(",")) roots.push(part.trim().split(/[\s.]/)[0]!);
  }
  for (const match of code.matchAll(/\bfrom\s+([\w.]+)\s+import\b/g)) {
    roots.push(match[1]!.split(".")[0]!);
  }
  return roots;
}

/** The quoted strings in a snippet, for judging what a spawned program would run. */
function stringLiterals(code: string): Array<string> {
  const found: Array<string> = [];
  for (const match of code.matchAll(
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\]|\\.)*)\x60/g,
  )) {
    found.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return found.filter((text) => text.trim().length > 0);
}

/**
 * Does this JavaScript or Python reach the internet? It does when it calls the network, when
 * it hides what it calls, or when it starts a program that would (`execSync('curl …')`).
 * A web address that it only reads, compares or prints is text. Inline code (`-e`, `-c`, a
 * heredoc or pipe into the interpreter) that reaches files, the system or other programs is
 * also code SKYCOT can't vouch for; a script file written and then run is judged like the
 * project's own scripts, by the internet alone.
 */
function codeMatches(
  code: string,
  language: Language,
  detail: string,
  depth: number,
  inline = true,
): Array<FamilyMatch> {
  const matches = networkCodeMatches(code, language, detail, depth);
  const touchesSystem =
    inline && (language === "js" ? jsTouchesSystem(code) : pythonTouchesSystem(code));
  return touchesSystem ? [...matches, reachesComputer(detail)] : matches;
}

function reachesComputer(detail: string): FamilyMatch {
  return { rule: familyRule("opaque-code"), detail, reachesComputer: true };
}

function networkCodeMatches(
  code: string,
  language: Language,
  detail: string,
  depth: number,
): Array<FamilyMatch> {
  const internet = [{ rule: familyRule("uses-internet"), detail }];
  if (language === "js") {
    if (JS_NETWORK.test(code)) return internet;
    if (JS_OPAQUE.test(code)) return [{ rule: familyRule("opaque-code"), detail }];
    if (!JS_SPAWN.test(code)) return [];
  } else {
    const imports = pythonImports(code);
    if (
      imports.some((name) => PY_NETWORK_MODULES.has(name)) ||
      PY_NETWORK_CALLS.test(code) ||
      PY_OPAQUE.test(code)
    ) {
      return internet;
    }
    if (!imports.some((name) => PY_SPAWN_MODULES.has(name)) && !PY_SPAWN.test(code)) return [];
  }
  // It starts another program: judge what it would run, word by word and all together, and
  // hold for any web address at all (it may be handed to that program).
  if (URL_PATTERN.test(code)) return internet;
  const literals = stringLiterals(code);
  return [literals.join(" "), ...literals].flatMap((text) => judge(text, false, depth + 1));
}

/** `ruby -e`, `perl -pi -e`, `php -r`, `osascript -e`, `pwsh -c`, `Rscript -e`, `lua -e`. */
function hasOtherInlineCode(tokens: ReadonlyArray<string>): boolean {
  return tokens
    .slice(1)
    .some(
      (token) =>
        /^-[A-Za-z]*[eErc]$/.test(token) ||
        /^-(?:command|encodedcommand|ec)$/i.test(token) ||
        /^--(?:eval|execute|command)(?:=|$)/.test(token),
    );
}

/** An interpreter given no script file, so it runs whatever arrives on its input. */
function readsCodeFromInput(tokens: ReadonlyArray<string>): boolean {
  const positional = tokens.slice(1).filter((arg) => !arg.startsWith("-") || arg === "-");
  return positional.length === 0 || positional[0] === "-";
}

/** `node -e "…"`, `python3 -c "…"`, `deno eval "…"`: the inline code and its language. */
function inlineCode(
  base: string,
  tokens: ReadonlyArray<string>,
): { code: string; language: Language } | null {
  const language: Language | null = JS_RUNTIMES.has(base)
    ? "js"
    : PYTHON_PROGRAM.test(base)
      ? "python"
      : null;
  if (language === null) return null;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (language === "js") {
      if (/^(-e|--eval|-p|--print|-pe|-ep)$/.test(token))
        return { code: tokens[index + 1] ?? "", language };
      if (/^--(eval|print)=/.test(token))
        return { code: token.slice(token.indexOf("=") + 1), language };
      if (base === "deno" && token === "eval") {
        const code = tokens.slice(index + 1).find((arg) => !arg.startsWith("-"));
        return { code: code ?? "", language };
      }
    } else if (/^-[A-Za-z]*c$/.test(token)) {
      return { code: tokens[index + 1] ?? "", language };
    }
    // The first plain word is a script file: not inline code.
    if (!token.startsWith("-")) break;
  }
  return null;
}

function runnerKind(base: string): RunnerKind | null {
  if (SHELL_PROGRAM.test(base) || base === "source" || base === ".") return "shell";
  if (JS_RUNTIMES.has(base)) return "js";
  if (PYTHON_PROGRAM.test(base)) return "python";
  if (OTHER_INTERPRETERS.has(base)) return "other";
  return null;
}

function stripLeadingControl(segment: string): string {
  let text = segment.trim();
  for (let guard = 0; guard < 8 && LEADING_CONTROL.test(text); guard += 1) {
    text = text.replace(LEADING_CONTROL, "").trim();
  }
  return text;
}

/** A step that turns the text piped into it into commands (`| sh`, `| xargs`, `| node`). */
function isCodeSink(segment: string): boolean {
  const text = stripLeadingControl(segment);
  const head = programBaseName(
    tokenize(text).find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) ?? "",
  ).toLowerCase();
  if (CODE_SINKS.has(head)) return true;
  const program = programTokens(text)[0];
  return program !== undefined && runnerKind(programBaseName(program).toLowerCase()) !== null;
}

/** The files a step writes: its redirections, and `tee`'s file names. */
function writtenFiles(segment: string): Array<string> {
  const written = fileWriteTargets(segment).map((write) => write.path);
  const tokens = programTokens(segment);
  if (programBaseName(tokens[0] ?? "").toLowerCase() === "tee") {
    written.push(...tokens.slice(1).filter((arg) => !arg.startsWith("-")));
  }
  return written.map((path) => programBaseName(path));
}

/** The script files the command runs, and what runs them: `node check.js`, `./run.sh`. */
function executedFiles(segments: ReadonlyArray<string>): Map<string, RunnerKind> {
  const executed = new Map<string, RunnerKind>();
  for (const segment of segments) {
    const tokens = programTokens(stripLeadingControl(segment));
    const program = tokens[0];
    if (program === undefined) continue;
    const base = programBaseName(program).toLowerCase();
    const kind = runnerKind(base);
    if (kind !== null) {
      for (const arg of tokens.slice(1)) {
        if (!arg.startsWith("-")) executed.set(programBaseName(arg), kind);
      }
    } else if (program.includes("/")) {
      executed.set(programBaseName(program), "other");
    }
  }
  return executed;
}

/** `a | b && c` -> [["a", "b"], ["c"]]; quotes are respected, like `splitShellSegments`. */
function splitPipelines(command: string): Array<Array<string>> {
  const pipelines: Array<Array<string>> = [];
  let pipeline: Array<string> = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  const endSegment = () => {
    if (current.trim().length > 0) pipeline.push(current.trim());
    current = "";
  };
  const endPipeline = () => {
    endSegment();
    if (pipeline.length > 0) pipelines.push(pipeline);
    pipeline = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    // `curl \⏎ https://x`: a line continuation is one step.
    if (ch === "\\" && command[i + 1] === "\n") {
      current += " ";
      i += 1;
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      endPipeline();
      i += 1;
      continue;
    }
    if (ch === "|" && command[i - 1] === ">") {
      current += ch;
      continue;
    }
    if (ch === "|") {
      endSegment();
      if (command[i + 1] === "&") i += 1;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "&") {
      // A lone `&` (background) ends the pipeline; `&>` and `2>&1` are redirections.
      if (ch === "&" && (command[i + 1] === ">" || command[i - 1] === ">")) {
        current += ch;
        continue;
      }
      endPipeline();
      continue;
    }
    current += ch;
  }
  endPipeline();
  return pipelines;
}

interface Heredoc {
  /** The command line the heredoc belongs to: `cat > check.js <<'EOF'`. */
  readonly line: string;
  readonly body: string;
  /** `<<'EOF'`: the shell runs nothing inside the body. */
  readonly quoted: boolean;
}

/**
 * Takes the heredoc bodies out of a script, so their lines are not judged as commands of
 * their own. A heredoc without its closing word is left in place and judged line by line.
 */
function extractHeredocs(text: string): { script: string; heredocs: Array<Heredoc> } {
  const heredocs: Array<Heredoc> = [];
  let script = "";
  let lineStart = 0;
  let quote: '"' | "'" | null = null;
  let pending: Array<{ word: string; quoted: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      script += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      script += ch;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      script += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text.startsWith("<<<", i)) {
      script += "<<<";
      i += 3;
      continue;
    }
    if (text.startsWith("<<", i)) {
      const marker = /^<<-?\s*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z0-9_.-]+))/.exec(text.slice(i));
      if (marker) {
        pending.push({
          word: marker[1] ?? marker[2] ?? marker[3]!,
          quoted: marker[1] !== undefined || marker[2] !== undefined || marker[0].includes("\\"),
        });
        script += marker[0];
        i += marker[0].length;
        continue;
      }
    }
    if (ch === "\n" && pending.length > 0) {
      const line = script.slice(lineStart);
      const bodies: Array<Heredoc> = [];
      let position = i + 1;
      let complete = true;
      for (const doc of pending) {
        const start = position;
        let found = false;
        while (position <= text.length) {
          const newline = text.indexOf("\n", position);
          const end = newline === -1 ? text.length : newline;
          // Looser than the shell about spaces around the closing word: a body that ends
          // early only means more lines are judged as commands.
          if (text.slice(position, end).trim() === doc.word) {
            bodies.push({ line, body: text.slice(start, position), quoted: doc.quoted });
            position = end + 1;
            found = true;
            break;
          }
          if (newline === -1) break;
          position = newline + 1;
        }
        if (!found) {
          complete = false;
          break;
        }
      }
      pending = [];
      if (complete) {
        heredocs.push(...bodies);
        script += "\n";
        lineStart = script.length;
        i = position;
        continue;
      }
    }
    script += ch;
    if (ch === "\n") lineStart = script.length;
    i += 1;
  }
  return { script, heredocs };
}

/** The text with single-quoted parts blanked: the shell runs no `$(…)` inside them. */
function withoutSingleQuoted(text: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
        out += ch;
      }
      continue;
    }
    if (quote === '"') {
      if (ch === '"' && text[i - 1] !== "\\") quote = null;
      out += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    out += ch;
  }
  return out;
}

/** The commands inside `<(…)` and `>(…)`. */
function processSubstitutions(text: string): Array<string> {
  return [...text.matchAll(/[<>]\(([^()]*)\)/g)]
    .map((match) => match[1]!.trim())
    .filter((inner) => inner.length > 0);
}

interface SegmentContext {
  /** Every web address here is text: the body of a file being written, not run. */
  readonly urlsAreText: boolean;
  /** The step's output is piped into something that runs it as commands. */
  readonly feedsCode: boolean;
  /** The step reads what the step before it in the pipeline writes (`echo … | node`). */
  readonly fedByPipe: boolean;
  /** Script files this command runs (see `executedFiles`). */
  readonly executed: ReadonlyMap<string, RunnerKind>;
  readonly depth: number;
}

/** Is the web address in this step only text, never a place the step goes? */
function urlIsText(
  base: string,
  tokens: ReadonlyArray<string>,
  segment: string,
  ctx: SegmentContext,
): boolean {
  if (ctx.urlsAreText) return true;
  if (ctx.feedsCode) return false;
  // `echo "$(curl …)"`, `cat <(curl …)`: the substitution is judged on its own, but the
  // step around it is not trusted to be text.
  if (/\$\(|\x60|<\(|>\(/.test(segment)) return false;
  // `echo "curl https://x" > run.sh && sh run.sh`: writing a script this command runs.
  if (writtenFiles(segment).some((file) => ctx.executed.has(file))) return false;
  const args = tokens.slice(1);
  if (base === "git") {
    const sub = args.find((arg) => !arg.startsWith("-"))?.toLowerCase() ?? "";
    return GIT_LOCAL_SUBCOMMANDS.test(sub);
  }
  if (!TEXT_PROGRAMS.has(base)) return false;
  // `find -exec`, GNU sed's `e` and awk's `system()` run other programs.
  if (base === "find") return !args.some((arg) => /^-(exec|execdir|ok|okdir)$/.test(arg));
  if (base === "sed") {
    return !args.some(
      (arg) =>
        !arg.startsWith("-") &&
        (/(^|[;\n{}\s])e(\s|;|$)/.test(arg) ||
          /^s(.).*\1.*\1[gpIiMm0-9w]*e[gpIiMm0-9]*$/.test(arg)),
    );
  }
  if (base.endsWith("awk")) return !/\bsystem\s*\(|getline|\/inet\/|print[^;]*\|/.test(segment);
  return true;
}

function segmentMatches(segment: string, ctx: SegmentContext): Array<FamilyMatch> {
  const inner = innerShellScript(segment);
  if (inner !== null) return judge(normalizeForMatching(inner), ctx.urlsAreText, ctx.depth + 1);
  const stripped = stripLeadingControl(segment);
  if (stripped !== segment.trim()) return segmentMatches(stripped, ctx);
  const matches: Array<FamilyMatch> = [];
  const hit = (id: FamilyRuleId) => matches.push({ rule: familyRule(id), detail: segment });
  // The raw words, before `programTokens` strips `sudo` and `npx` to find the real program:
  // here the wrapper is the point.
  const words = tokenize(segment);
  const raw = words.map((token) => programBaseName(token).toLowerCase());
  const first = raw.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  const head = first >= 0 ? raw[first] : undefined;
  const second = first >= 0 ? raw[first + 1] : undefined;
  if (head !== undefined && ADMIN_PROGRAMS.has(head)) hit("admin-rights");
  if (
    (head !== undefined && DOWNLOADING_RUNNERS.has(head)) ||
    ((head === "pnpm" || head === "yarn") && second === "dlx") ||
    (head === "deno" && words.some((word) => /^(npm|jsr|https?):/.test(word)))
  ) {
    hit("installs-software");
    hit("uses-internet");
  }

  const tokens = programTokens(segment);
  const program = tokens[0];
  if (program === undefined) {
    // `for u in https://a https://b`: no program to judge the address by.
    if (URL_PATTERN.test(segment) && !ctx.urlsAreText) hit("uses-internet");
    return matches;
  }
  const base = programBaseName(program).toLowerCase();
  const positional = tokens.slice(1).filter((arg) => !arg.startsWith("-"));
  const sub = positional[0]?.toLowerCase() ?? "";

  if (NETWORK_PROGRAMS.has(base)) hit("uses-internet");
  if (base === "git" && GIT_NETWORK_SUBCOMMANDS.test(sub)) hit("uses-internet");
  if (base === "git" && sub === "lfs" && /^(fetch|pull|push|clone)$/.test(positional[1] ?? ""))
    hit("uses-internet");
  if (base === "git" && sub === "archive" && segment.includes("--remote")) hit("uses-internet");
  if ((base === "open" || base === "xdg-open") && URL_PATTERN.test(segment)) hit("uses-internet");
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
  // `eval "…"` runs its words as a script.
  if (base === "eval") matches.push(...judge(tokens.slice(1).join(" "), false, ctx.depth + 1));
  if (OTHER_INTERPRETERS.has(base) && OTHER_NETWORK_CODE.test(segment)) hit("uses-internet");

  const code = inlineCode(base, tokens);
  const kind = runnerKind(base);
  if (
    !ctx.urlsAreText &&
    kind !== null &&
    kind !== "shell" &&
    ((kind === "other" && hasOtherInlineCode(tokens)) ||
      (code === null && ctx.fedByPipe && readsCodeFromInput(tokens)))
  ) {
    // Inline code in another language, or a program read from a pipe: SKYCOT can't vouch for it.
    matches.push(reachesComputer(segment));
  }
  if (code !== null && !ctx.urlsAreText) {
    // A web address in the code is judged by what the code does with it.
    matches.push(...codeMatches(code.code, code.language, segment, ctx.depth));
  } else if (URL_PATTERN.test(segment) && !urlIsText(base, tokens, segment, ctx)) {
    hit("uses-internet");
  }
  return matches;
}

/** How a heredoc's body is judged: by what reads it on its command line. */
function heredocMatches(
  doc: Heredoc,
  executed: ReadonlyMap<string, RunnerKind>,
  urlsAreText: boolean,
  depth: number,
): Array<FamilyMatch> {
  const detail = doc.line.trim();
  const segments = splitShellSegments(doc.line);
  const heads = segments.map((segment) => {
    const text = stripLeadingControl(segment);
    const rawHead = programBaseName(
      tokenize(text).find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) ?? "",
    ).toLowerCase();
    if (CODE_SINKS.has(rawHead)) return "eval";
    return programBaseName(programTokens(text)[0] ?? "").toLowerCase();
  });
  const byKind = (kind: RunnerKind, inline = true): Array<FamilyMatch> =>
    kind === "js" || kind === "python"
      ? codeMatches(doc.body, kind, detail, depth, inline)
      : kind === "other" && inline
        ? [reachesComputer(detail)]
        : judge(doc.body, false, depth + 1);
  const substitutions = doc.quoted
    ? []
    : commandSubstitutions(doc.body).flatMap((inner) => judge(inner, false, depth + 1));
  const kinds = new Set(heads.map((head) => (head === "eval" ? "shell" : runnerKind(head))));
  for (const kind of ["shell", "js", "python", "other"] as const) {
    if (kinds.has(kind)) return [...byKind(kind), ...substitutions];
  }
  if (heads.every((head) => TEXT_PROGRAMS.has(head))) {
    // `cat > check.js <<'EOF'`: a file being written. It is judged as code only when this
    // same command then runs it (`… EOF && node check.js`).
    const runs = segments
      .flatMap(writtenFiles)
      .map((file) => executed.get(file))
      .filter((kind): kind is RunnerKind => kind !== undefined);
    if (runs.length > 0) {
      return [...runs.flatMap((kind) => byKind(kind, false)), ...substitutions];
    }
    return [...judge(doc.body, true, depth + 1), ...substitutions];
  }
  // Something else reads it (`sqlite3 db <<EOF`): judged as commands, web addresses and all.
  return [...judge(doc.body, urlsAreText, depth + 1), ...substitutions];
}

/** Every family rule a piece of shell text trips. */
function judge(text: string, urlsAreText: boolean, depth: number): Array<FamilyMatch> {
  // Too many layers of scripts inside scripts to follow: a grown-up decides.
  if (depth > 8) return [{ rule: familyRule("uses-internet"), detail: text }];
  const { script, heredocs } = extractHeredocs(text);
  const pipelines = splitPipelines(script);
  const executed = executedFiles(pipelines.flat());
  const matches: Array<FamilyMatch> = [];
  for (const pipeline of pipelines) {
    pipeline.forEach((segment, index) => {
      const feedsCode = pipeline.slice(index + 1).some(isCodeSink);
      matches.push(
        ...segmentMatches(segment, {
          urlsAreText,
          feedsCode,
          fedByPipe: index > 0,
          executed,
          depth,
        }),
      );
    });
  }
  for (const doc of heredocs) matches.push(...heredocMatches(doc, executed, urlsAreText, depth));
  const runnable = withoutSingleQuoted(script);
  for (const inner of [...commandSubstitutions(runnable), ...processSubstitutions(runnable)]) {
    matches.push(...judge(inner, false, depth + 1));
  }
  return matches;
}

/** One match per rule; one that reaches the computer wins over a plain one of the same rule. */
function unique(matches: ReadonlyArray<FamilyMatch>): Array<FamilyMatch> {
  const byRule = new Map<FamilyRuleId, FamilyMatch>();
  for (const match of matches) {
    const kept = byRule.get(match.rule.id);
    if (kept === undefined || (match.reachesComputer && !kept.reachesComputer)) {
      byRule.set(match.rule.id, match);
    }
  }
  return [...byRule.values()];
}

/** The family rules a shell command trips; empty for ordinary project work. */
export function familyCommandMatches(command: string): Array<FamilyMatch> {
  return unique(judge(normalizeForMatching(unwrapShellWrapper(command.trim())), false, 0));
}

/**
 * The one entry point both sides use. Anything a hard rule holds needs a grown-up, and so does
 * anything that reaches the internet or installs software. Everything else the child may
 * allow (or decline) on their own card.
 */
export function evaluateFamilyRequest(
  request: FamilyRequest,
  ctx: FamilyContext = {},
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
  const needsGrownUp = base.decision === "hold" || matches.length > 0;
  if (needsGrownUp && request.toolItemType !== "web_search") {
    const relieved = reliefFor(request, ctx, base, matches);
    if (relieved !== null) {
      return {
        needsGrownUp: false,
        base: { decision: "allow", risk: "low", matches: [] },
        family: [],
        ...relieved,
      };
    }
  }
  return { needsGrownUp, base, family: matches };
}

// ── Reliefs: held by a rule, the child's step all the same ────────────────────────────
// Each one is narrow on purpose: it applies only when everything that held the step is the one
// thing the relief answers. An add-on ask that also leaves the project, a delete that also
// reaches the internet, anything with a rule the relief does not cover: a grown-up, as before.

/** Codex asks to leave its sandbox for an install; SKYCOT's own install makes that moot. */
const ADD_ON_HARD_RULES: ReadonlySet<HardRuleId> = new Set(["leaves-sandbox"]);
const ADD_ON_FAMILY_RULES: ReadonlySet<FamilyRuleId> = new Set([
  "uses-internet",
  "installs-software",
]);
const DELETE_HARD_RULES: ReadonlySet<HardRuleId> = new Set([
  "deletes-files",
  "destructive-command",
]);

function reliefFor(
  request: FamilyRequest,
  ctx: FamilyContext,
  base: RuleEvaluation,
  matches: ReadonlyArray<FamilyMatch>,
): { readonly relief: FamilyRelief; readonly addOns?: ReadonlyArray<string> } | null {
  if (request.kind === "command" && request.command !== undefined) {
    const ask = ctx.skycotFetchesAddOns === true ? addOnAskOf(request.command) : null;
    if (
      ask !== null &&
      ask.names.length > 0 &&
      base.matches.every((match) => ADD_ON_HARD_RULES.has(match.rule.id)) &&
      matches.every((match) => ADD_ON_FAMILY_RULES.has(match.rule.id))
    ) {
      if (ctx.trustedAddOns === true && isTrustedAddOnAsk(ask)) {
        return { relief: "trusted-add-on", addOns: ask.names };
      }
      const approved = new Set(ctx.approvedAddOns ?? []);
      if (ask.names.every((name) => approved.has(name))) {
        return { relief: "approved-before", addOns: ask.names };
      }
    }
  }
  if (
    ctx.keepsVersions === true &&
    matches.length === 0 &&
    request.leavesSandbox !== true &&
    base.matches.every((match) => DELETE_HARD_RULES.has(match.rule.id)) &&
    isUndoableProjectDelete(request, ctx)
  ) {
    return { relief: "undoable-delete" };
  }
  return null;
}

// ── Deleting inside the project, when a restore point can bring it back ────────────────
// Only the plainest shapes: `rm`, `rm -r`, `rm -rf`, `rmdir` of named files and folders inside
// the conversation's own folder, or the assistant's own file delete there. Never the folder
// itself, `.git` or any hidden name, `..`, `~`, an absolute path elsewhere, a wildcard, a
// variable, a substitution, a pipe, `find -delete`, `xargs rm`, or anything else on the line.

const DELETE_FLAG = /^-[rRfdv]+$|^--(?:recursive|force|dir|verbose)$/u;
/** Characters that could make a delete reach further than the words say. */
const ESCAPING = /[*?[\]{}~$`()<>|&;!\\'"\n#=]/u;

function normalizeRoot(root: string): string {
  return root.replace(/\/+$/u, "");
}

/** The path inside the project, as plain steps (`src/old.js` → ["src", "old.js"]); null if not. */
function projectSteps(path: string, root: string): ReadonlyArray<string> | null {
  if (path.length === 0 || ESCAPING.test(path) || path.includes("\\")) return null;
  let relative = path;
  if (path.startsWith("/")) {
    const prefix = `${normalizeRoot(root)}/`;
    if (!path.startsWith(prefix)) return null;
    relative = path.slice(prefix.length);
  }
  const steps = relative.split("/").filter((step, index) => !(index === 0 && step === "."));
  const named = steps.filter((step, index) => !(index === steps.length - 1 && step === ""));
  if (named.length === 0) return null;
  // Hidden names (.git, .env, .skycot), `.` and `..` anywhere: a grown-up.
  if (named.some((step) => step.length === 0 || step.startsWith("."))) return null;
  return named;
}

function undoableDeleteCommand(command: string, root: string): boolean {
  const script = unwrapShellWrapper(command.trim()).trim();
  if (script.length === 0 || /[|<>`$()\n]|(^|[^&])&(?!&)/u.test(script)) return false;
  const steps = script.split(/\s*(?:&&|;)\s*/u);
  return steps.every((step) => {
    const words = step.split(/\s+/u).filter((word) => word.length > 0);
    const [program, ...rest] = words;
    if (program !== "rm" && program !== "rmdir") return false;
    let paths = 0;
    let endOfFlags = false;
    for (const word of rest) {
      if (!endOfFlags && word === "--") {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && word.startsWith("-")) {
        if (!DELETE_FLAG.test(word)) return false;
        continue;
      }
      if (projectSteps(word, root) === null) return false;
      paths += 1;
    }
    return paths > 0;
  });
}

/**
 * True when the request only deletes named files or folders inside the conversation's own
 * folder (`ctx.projectRoot`), never the folder itself or a hidden path. Pure; the caller says
 * whether the folder keeps versions.
 */
export function isUndoableProjectDelete(request: RuleRequest, ctx: RuleContext): boolean {
  const root = ctx.projectRoot;
  if (typeof root !== "string" || !root.startsWith("/") || normalizeRoot(root).length === 0) {
    return false;
  }
  if (request.kind === "command") {
    return request.command !== undefined && undoableDeleteCommand(request.command, root);
  }
  if (request.kind === "file-change") {
    const files = request.files ?? [];
    return (
      files.some((file) => file.operation === "remove") &&
      files.every((file) => file.path.startsWith("/") && projectSteps(file.path, root) !== null)
    );
  }
  return false;
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

// ── Plan first: only looking around while the plan is made ───────────────────────────
// While a child's turn plans (SkycotFamilyInstructions plan first), nothing may change before
// they press "Build it". The engine runs safe steps by themselves in the Family profile, so
// during a plan only steps that just look are allowed that way: reading files, and commands
// that only list, print or search. Anything else keeps its card. When in doubt it is not
// read-only: asking once too often is the safe side.

/** Programs that only print, list or search, and never write a file or start another one. */
const READ_ONLY_PROGRAMS = new Set([
  "node",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "pwd",
  "stat",
  "file",
  "tree",
  "du",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "echo",
  "printf",
  "sort",
  "cut",
  "tr",
  "diff",
  "cmp",
  "comm",
  "nl",
  "column",
  "fold",
  "rev",
  "strings",
  "md5",
  "md5sum",
  "shasum",
  "sha256sum",
  "which",
  "true",
  "false",
  "test",
  "[",
  "whoami",
  "uname",
  "jq",
  "find",
  "sed",
  "git",
  "cd",
]);
/** Flags that make an otherwise read-only program write a file or run another program. */
const WRITING_FLAGS: Readonly<Record<string, RegExp>> = {
  sort: /^(-o|--output)/,
  tree: /^-o$/,
  file: /^-C$/,
  rg: /^--pre(=|$)/,
  find: /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
  git: /^(--output|-O$|--open-files-in-pager|--ext-diff|--textconv)/,
};
const GIT_READ_ONLY = /^(status|log|diff|show|ls-files|rev-parse|blame|grep|describe|shortlog)$/;
/** `sed -n '1,200p' file`: printing lines is all it may do. */
const SED_PRINT_SCRIPT = /^\s*(\d+|\$)?\s*(,\s*(\d+|\$)\s*)?p\s*$/;
const SED_QUIET_FLAGS = new Set(["-n", "--quiet", "--silent", "-E", "-r", "-u"]);

function segmentOnlyReads(segment: string): boolean {
  if (fileWriteTargets(segment).length > 0) return false;
  const tokens = tokenize(segment);
  const program = tokens[0];
  // An environment assignment or a wrapper (`env`, `sudo`, `xargs`) is never "just looking".
  if (program === undefined || program.includes("=")) return false;
  const base = programBaseName(program).toLowerCase();
  if (program.includes("/") && base !== program) return false;
  if (!READ_ONLY_PROGRAMS.has(base)) return false;
  const args = tokens.slice(1);
  if (base === "node") return args.length === 2 && args[0] === "--check";
  const writing = WRITING_FLAGS[base];
  if (writing !== undefined && args.some((arg) => writing.test(arg))) return false;
  if (base === "git") return args[0] !== undefined && GIT_READ_ONLY.test(args[0]);
  if (base === "sed") {
    const flags = args.filter((arg) => arg.startsWith("-"));
    const script = args.find((arg) => !arg.startsWith("-"));
    return (
      flags.every((flag) => SED_QUIET_FLAGS.has(flag)) &&
      flags.some((flag) => flag === "-n" || flag === "--quiet" || flag === "--silent") &&
      script !== undefined &&
      SED_PRINT_SCRIPT.test(script)
    );
  }
  return true;
}

/**
 * True when every step of the command only lists, prints or searches: no file is written, no
 * other program is started, nothing reaches another computer. Codex's `/bin/zsh -lc "…"` is
 * judged by the script inside. Command substitutions, here-documents, background steps and
 * anything unknown are not read-only.
 */
export function isReadOnlyCommand(command: string): boolean {
  const script = unwrapShellWrapper(command).trim();
  if (script.length === 0) return false;
  if (commandSubstitutions(script).length > 0 || /\$\(|`|<<|[<>]\(/.test(script)) return false;
  // A lone `&` runs a step in the background; `&&`, `&>` and `2>&1` are not that.
  if (/(^|[^&>])&(?![&>])/.test(script.replace(/\d>&\d/g, ""))) return false;
  const segments = splitShellSegments(script);
  return segments.length > 0 && segments.every(segmentOnlyReads);
}
