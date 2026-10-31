import type {
  OrchestrationV2PlanStep,
  OrchestrationV2RunStatus,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
  OrchestrationV2TurnItemStatus,
  ProviderApprovalDecision,
} from "@t3tools/contracts";

import { readPolicyDecision } from "@t3tools/skycot-rules/decision";
import { isOutsideProject } from "@t3tools/skycot-rules/files";
import { readCommandAsk } from "@t3tools/skycot-rules/rules";
import {
  fileWriteTargets,
  programTokens,
  splitShellSegments,
  unwrapShellWrapper,
} from "@t3tools/skycot-rules/shell";

import { describeFile, humanizeFileName } from "./changes";
import { errors, progress } from "./copy";
import { kidNouns, kidStep, kidTestOutcome, type KidThing } from "./kidWords";
import { describeOwnTool, isOwnToolServer, ownToolName, withSkycotName } from "./ownTools";

/** "use Linear", or for one of SKYCOT's own tools what it does ("open your page to check it"). */
function ownToolAsk(item: {
  readonly appName?: string | null | undefined;
  readonly prompt?: string | null | undefined;
}): string {
  const tool = isOwnToolServer(item.appName)
    ? (ownToolName(item.prompt) ?? "")
    : ownToolName(item.prompt);
  if (tool !== null) return describeOwnTool(tool).infinitive;
  return `use ${item.appName ?? "a connected app"}`;
}

// The shell primitives live in the shared rules package so the server policy and the
// narrator split a command identically; re-exported for the tests and callers that had them.
export { splitShellSegments, unwrapShellWrapper };

export type NarrationKind =
  | "message"
  | "reasoning"
  | "edit"
  | "read"
  | "command"
  | "search"
  | "web"
  | "subagent"
  | "test"
  | "install"
  | "git"
  | "other";

export type NarrationStatus = "pending" | "running" | "done" | "failed" | "denied";

export type CommandRisk = "low" | "medium" | "high";

export interface Narration {
  readonly headline: string;
  readonly detail?: string | undefined;
  readonly kind: NarrationKind;
  readonly status: NarrationStatus;
  /** The raw thing (path, command, tool name) for the "Show details" disclosure. */
  readonly technical: string;
  readonly risk?: CommandRisk | undefined;
}

export interface NarrationContext {
  readonly projectName?: string;
  /** Lets the narrator say "denied" for approvals the user declined. */
  readonly runtimeRequests?: ReadonlyMap<
    string,
    Pick<OrchestrationV2RuntimeRequest, "decision" | "status"> &
      Partial<Pick<OrchestrationV2RuntimeRequest, "answers">>
  >;
  /**
   * The run was stopped (Stop pressed): a step that never ran was cancelled,
   * not refused. Unset, a step that didn't run is one the person said no to.
   */
  readonly stopped?: boolean;
  /**
   * Files the run asked to delete (from its file-change asks). A refused delete
   * arrives as a bare file item, so this is how the narrator knows the verb.
   */
  readonly deletedPaths?: ReadonlySet<string>;
  /** The thread's own note of when the provider's allowance resets, if it has one. */
  readonly usageLimitResetAt?: string | null;
  /**
   * Each command's exact text by its native item (`commandInputKey`), so an ask is narrated
   * from the command it is about, never from the provider's reason or title.
   */
  readonly commandInputs?: ReadonlyMap<string, string>;
  /** The viewer is a child: progress lines use kid words ("Testing your game"). */
  readonly kid?: boolean;
  /** What the child is making, for "Testing your game" or "Testing your page". */
  readonly kidThing?: KidThing;
}

type NativeItemRef = OrchestrationV2TurnItem["nativeItemRef"];

function commandInputKey(ref: NativeItemRef): string | null {
  return ref === null || ref.nativeId === null ? null : `${ref.driver}:${ref.nativeId}`;
}

/**
 * Puts each ask directly before the step it allowed. Codex opens the step's item a moment
 * before it asks, so event order (and every timestamp but the decision) lists "Tried to
 * upload … — it didn't work" above "SKYCOT rules allowed the assistant to upload …",
 * although the answer came first and the step ran after it. Accepts any list whose entries
 * carry an `item`, so callers can keep their narration alongside.
 */
export function askBeforeItsStep<Entry extends { readonly item: OrchestrationV2TurnItem }>(
  entries: ReadonlyArray<Entry>,
): Array<Entry> {
  const asksByStep = new Map<string, Array<Entry>>();
  for (const entry of entries) {
    if (entry.item.type !== "approval_request") continue;
    const key = commandInputKey(entry.item.nativeItemRef);
    if (key !== null) asksByStep.set(key, [...(asksByStep.get(key) ?? []), entry]);
  }
  if (asksByStep.size === 0) return [...entries];
  const ordered: Array<Entry> = [];
  const placed = new Set<Entry>();
  for (const entry of entries) {
    if (placed.has(entry)) continue;
    if (entry.item.type === "command_execution") {
      const key = commandInputKey(entry.item.nativeItemRef);
      for (const ask of key === null ? [] : (asksByStep.get(key) ?? [])) {
        if (placed.has(ask)) continue;
        ordered.push(ask);
        placed.add(ask);
      }
    }
    ordered.push(entry);
    placed.add(entry);
  }
  return ordered;
}

/** The `commandInputs` map for a list of items. */
export function commandInputsOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyMap<string, string> {
  const inputs = new Map<string, string>();
  for (const item of items) {
    if (item.type !== "command_execution") continue;
    const key = commandInputKey(item.nativeItemRef);
    if (key !== null) inputs.set(key, item.input);
  }
  return inputs;
}

export interface CommandClassification {
  readonly kind: NarrationKind;
  readonly risk: CommandRisk;
  /** "Installed 1 add-on: a date picker" */
  readonly past: string;
  /** "Installing 1 add-on: a date picker" */
  readonly present: string;
  /** "install 1 add-on: a date picker" — for "wants to …" sentences. */
  readonly infinitive: string;
  readonly program: string | null;
  readonly touches: "only this project" | "your computer" | "the internet" | "something live";
  readonly warning?: string;
  /** Set when the command installs named packages, for size/cost hints. */
  readonly packages?: ReadonlyArray<string>;
}

interface Verb {
  readonly past: string;
  readonly present: string;
  readonly infinitive: string;
}

const verb = (infinitive: string, past: string, present: string): Verb => ({
  infinitive,
  past,
  present,
});

const KNOWN_PACKAGES: Record<string, string> = {
  "react-datepicker": "a date picker",
  "react-day-picker": "a date picker",
  dayjs: "a date helper",
  "date-fns": "a date helper",
  luxon: "a date helper",
  moment: "a date helper",
  axios: "a web request helper",
  zod: "a form and data checker",
  yup: "a form and data checker",
  "react-hook-form": "a form helper",
  formik: "a form helper",
  tailwindcss: "a styling toolkit",
  "styled-components": "a styling toolkit",
  "@emotion/react": "a styling toolkit",
  "framer-motion": "an animation library",
  motion: "an animation library",
  "lucide-react": "an icon set",
  "react-icons": "an icon set",
  "@heroicons/react": "an icon set",
  recharts: "a charting library",
  "chart.js": "a charting library",
  d3: "a charting library",
  stripe: "the Stripe payments toolkit",
  "@stripe/stripe-js": "the Stripe payments toolkit",
  prisma: "a database toolkit",
  "@prisma/client": "a database toolkit",
  drizzle: "a database toolkit",
  mongoose: "a database toolkit",
  express: "a web server",
  fastify: "a web server",
  next: "the Next.js website framework",
  react: "the React toolkit",
  "react-dom": "the React toolkit",
  vue: "the Vue toolkit",
  svelte: "the Svelte toolkit",
  vite: "a build tool",
  typescript: "the TypeScript language tools",
  vitest: "a testing tool",
  jest: "a testing tool",
  playwright: "a browser testing tool",
  "@playwright/test": "a browser testing tool",
  cypress: "a browser testing tool",
  eslint: "a style checker",
  prettier: "a code formatter",
  lodash: "a grab-bag of helpers",
  uuid: "an ID generator",
  dotenv: "a secret-settings loader",
  "@supabase/supabase-js": "the Supabase toolkit",
  firebase: "the Firebase toolkit",
  "next-auth": "a sign-in toolkit",
  "@auth/core": "a sign-in toolkit",
  nodemailer: "an email sender",
  resend: "an email sender",
  sharp: "an image processor",
  marked: "a Markdown renderer",
  "react-markdown": "a Markdown renderer",
  i18next: "a translations toolkit",
};

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "pnpx", "bunx"]);
const INSTALL_SUBCOMMANDS = new Set(["install", "i", "add", "ci"]);
const TEST_SUBCOMMANDS = new Set(["test", "t", "vitest", "jest"]);
const BUILD_SUBCOMMANDS = new Set(["build", "compile"]);
const LINT_SUBCOMMANDS = new Set(["lint", "format", "fmt", "prettier", "eslint"]);
const TYPECHECK_SUBCOMMANDS = new Set(["typecheck", "tsc", "check-types", "type-check"]);
const DEV_SUBCOMMANDS = new Set(["dev", "start", "serve", "preview"]);
const READ_PROGRAMS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "tree",
  "pwd",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "whoami",
  "echo",
  "printf",
  "env",
  "printenv",
  "type",
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
  "date",
  "uname",
  "sw_vers",
  "hostname",
  "nproc",
  "uptime",
]);
const SEARCH_PROGRAMS = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "find",
  "fd",
  "fdfind",
  "locate",
  "awk",
]);
const SCRIPT_PROGRAMS = new Set([
  "node",
  "python",
  "python3",
  "py",
  "ruby",
  "perl",
  "php",
  "deno",
  "tsx",
  "ts-node",
  "java",
  "go",
  "cargo",
  "dotnet",
  "swift",
  "lua",
  "bash",
  "sh",
  "zsh",
]);
const NETWORK_PROGRAMS = new Set([
  "curl",
  "wget",
  "http",
  "httpie",
  "ssh",
  "scp",
  "rsync",
  "ftp",
  "sftp",
  "nc",
  "ncat",
  "telnet",
  "ping",
  "dig",
  "nslookup",
  "gh",
  "glab",
  "aws",
  "gcloud",
  "az",
  "vercel",
  "netlify",
  "fly",
  "flyctl",
  "heroku",
  "wrangler",
  "firebase",
  "supabase",
  "railway",
  "render",
]);
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
]);
const CONTAINER_PROGRAMS = new Set([
  "docker",
  "docker-compose",
  "podman",
  "kubectl",
  "helm",
  "minikube",
  "kind",
]);
const SYSTEM_PACKAGE_MANAGERS = new Set([
  "brew",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pacman",
  "choco",
  "winget",
  "snap",
  "pip",
  "pip3",
  "pipx",
  "gem",
  "cargo",
  "go",
]);
const DELETE_PROGRAMS = new Set(["rm", "rmdir", "del", "erase", "rd", "shred", "unlink", "trash"]);
const FILE_PROGRAMS = new Set([
  "mkdir",
  "touch",
  "cp",
  "mv",
  "ln",
  "chmod",
  "chown",
  "tee",
  "sed",
  "patch",
  "tar",
  "zip",
  "unzip",
  "gzip",
  "gunzip",
]);

const PAYMENT_PATTERN =
  /\b(stripe|paypal|braintree|adyen|square(up)?|checkout\.com|razorpay|charge|payment|payout|refund|invoice)s?\b/i;
const SQL_DESTRUCTIVE_PATTERN =
  /\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)|TRUNCATE(\s+TABLE)?|DELETE\s+FROM\s+\w+\s*;?\s*$|DELETE\s+FROM\s+\w+\s*(?!WHERE))/i;
const PIPE_TO_SHELL_PATTERN = /\|\s*(sudo\s+)?(ba|z|da)?sh\b/;
const FORCE_PUSH_PATTERN = /\bpush\b[^|;&]*(--force\b|-f\b|--force-with-lease\b|\+[\w/-]+)/;
const DEFAULT_BRANCH_PUSH_PATTERN = /\bpush\b[^|;&]*\b(main|master|production|prod|release)\b/;
const RM_RECURSIVE_FORCE_PATTERN = /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+/;
const DANGEROUS_PATHS_PATTERN = /(^|\s)(\/|~|~\/|\$HOME|\/\*|\.\.|\*)(\s|$)/;

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** Splits on `&&`, `;`, `||` and `|` outside quotes. Good enough for narration, not for execution. */
/**
 * A here-document's body is data, not steps. What follows the marker on its own line still
 * counts: `cat <<'EOF' > index.html` writes the page.
 */
const HEREDOC_PATTERN = /<<-?\s*(['"]?)\w+\1([^\n]*)[\s\S]*$/;

const INSTALL_VALUE_FLAGS = new Set([
  "--cache",
  "--registry",
  "--prefix",
  "--userconfig",
  "--globalconfig",
  "--workspace",
  "-w",
  "--tag",
  "--store-dir",
  "--filter",
  "--cwd",
  "--modules-folder",
]);

function installPositionals(args: ReadonlyArray<string>): Array<string> {
  const words: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (INSTALL_VALUE_FLAGS.has(arg)) index++;
    else if (!arg.startsWith("-")) words.push(arg);
  }
  return words;
}

function stripFlags(args: ReadonlyArray<string>): Array<string> {
  return args.filter((arg) => !arg.startsWith("-"));
}

/** "look at the booking page" / "look at 3 files: …" for cat, head, sed -n and friends. */
function lookAt(targets: ReadonlyArray<string>): Verb {
  const what =
    targets.length === 1
      ? describeFile(targets[0]!).noun
      : // Two SKILL.md files are "2 files: the skill text", not "the skill text and the skill text".
        `${pluralize(targets.length, "file")}: ${joinList([...new Set(targets.map((t) => describeFile(t).noun))])}`;
  return verb(`look at ${what}`, `looked at ${what}`, `looking at ${what}`);
}

/** Search flags that take a value, so `rg -g '*.html' -n booking` searches for "booking". */
const SEARCH_VALUE_FLAGS = new Set([
  "-g",
  "--glob",
  "--iglob",
  "-t",
  "--type",
  "-T",
  "--type-not",
  "-m",
  "--max-count",
  "-A",
  "-B",
  "-C",
  "--include",
  "--exclude",
  "--exclude-dir",
  "-e",
  "--regexp",
  "-E",
  "--extension",
]);

function searchPattern(base: string, args: ReadonlyArray<string>): string | undefined {
  if (base === "find" || base === "locate") {
    const named = args.findIndex((arg) => /^-i?name$|^-i?path$|^-i?regex$/.test(arg));
    if (named !== -1) return args[named + 1];
    return stripFlags(args).find((arg) => arg !== "." && arg !== "./");
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith("-")) {
      if (SEARCH_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    // `-e pattern` names the pattern explicitly; otherwise the first positional is it.
    return arg;
  }
  const explicit = args.findIndex((arg) => arg === "-e" || arg === "--regexp");
  return explicit === -1 ? undefined : args[explicit + 1];
}

function describePackage(name: string): string {
  const bare = name.replace(/@[^@/]+$/, "");
  // Keep the real name next to the friendly one: a grown-up deciding needs it.
  const known = KNOWN_PACKAGES[bare];
  return known === undefined ? `the "${bare}" add-on` : `${known} (${bare})`;
}

/**
 * A step that writes a file through `>`, `>>` or `tee` is an edit, never "only reads files"
 * (QA FK-04). Commands with their own meaning (an install that logs to a file) keep it.
 */
function classifySegment(segment: string): CommandClassification | null {
  const classified = classifySegmentProgram(segment);
  const writes = fileWriteTargets(segment);
  if (writes.length === 0) return classified;
  if (classified !== null && classified.kind !== "read" && classified.kind !== "search") {
    return classified;
  }
  const program = programTokens(segment)[0];
  const emptiesOnly = program === undefined || program === ">" || program === ":";
  return describeWrites(
    writes.map((write) => write.path),
    writes.every((write) => write.append),
    emptiesOnly,
    /(^|\s)(sudo|doas)\s/.test(segment),
    classified?.program ?? null,
  );
}

function describeWrites(
  targets: ReadonlyArray<string>,
  append: boolean,
  emptiesOnly: boolean,
  elevated: boolean,
  program: string | null,
): CommandClassification {
  const unique = [...new Set(targets)];
  const what = joinList(unique.map((target) => describeFile(target).noun));
  const outside = unique.some((target) => isOutsideProject(target, undefined));
  const v = emptiesOnly
    ? verb(`empty ${what}`, `emptied ${what}`, `emptying ${what}`)
    : append
      ? verb(`add to ${what}`, `added to ${what}`, `adding to ${what}`)
      : verb(`write ${what}`, `wrote ${what}`, `writing ${what}`);
  const suffix = elevated ? " as the computer's administrator" : "";
  return {
    kind: "edit",
    risk: elevated ? "high" : outside || emptiesOnly ? "medium" : "low",
    past: capitalize(`${v.past}${suffix}`),
    present: capitalize(`${v.present}${suffix}`),
    infinitive: `${v.infinitive}${suffix}`,
    program,
    touches: outside || elevated ? "your computer" : "only this project",
    ...(elevated
      ? { warning: "Administrator commands can change anything on this computer." }
      : {}),
  };
}

function classifySegmentProgram(segment: string): CommandClassification | null {
  const elevated = /(^|\s)(sudo|doas)\s/.test(segment);
  const tokens = programTokens(segment);
  const program = tokens[0] ?? null;
  if (!program) return null;
  const args = tokens.slice(1);
  const base = program.split("/").at(-1)!;

  const make = (
    kind: NarrationKind,
    risk: CommandRisk,
    v: Verb,
    touches: CommandClassification["touches"] = "only this project",
    extra: Partial<Pick<CommandClassification, "warning" | "packages">> = {},
  ): CommandClassification => ({
    kind,
    risk: elevated ? "high" : risk,
    past: capitalize(elevated ? `${v.past} as the computer's administrator` : v.past),
    present: capitalize(elevated ? `${v.present} as the computer's administrator` : v.present),
    infinitive: elevated ? `${v.infinitive} as the computer's administrator` : v.infinitive,
    program: base,
    touches: elevated && touches === "only this project" ? "your computer" : touches,
    ...extra,
    ...(elevated && !extra.warning
      ? { warning: "Administrator commands can change anything on this computer." }
      : {}),
  });

  if (
    base === "cd" ||
    base === "pushd" ||
    base === "popd" ||
    base === "export" ||
    base === "set" ||
    base === "source" ||
    base === "." ||
    base === "true" ||
    base === "clear" ||
    // `exit "$failed"` only hands back the result; it is not a step.
    base === "exit" ||
    base === "return"
  ) {
    return null;
  }

  if (base === "sudo" || base === "doas") {
    return make(
      "command",
      "high",
      verb(
        "run a command as the computer's administrator",
        "ran a command as the computer's administrator",
        "running a command as the computer's administrator",
      ),
      "your computer",
      { warning: "Administrator commands can change anything on this computer." },
    );
  }

  if (base === "git") {
    const sub = stripFlags(args)[0] ?? "";
    const forcePush = FORCE_PUSH_PATTERN.test(segment);
    const toDefault = DEFAULT_BRANCH_PUSH_PATTERN.test(segment);
    switch (sub) {
      case "status":
        return make(
          "git",
          "low",
          verb(
            "check which files have changed",
            "checked which files have changed",
            "checking which files have changed",
          ),
        );
      case "diff":
      case "show":
        return make(
          "git",
          "low",
          verb("look at what changed", "looked at what changed", "looking at what changed"),
        );
      case "log":
      case "blame":
      case "reflog":
        return make(
          "git",
          "low",
          verb(
            "look through the project's history",
            "looked through the project's history",
            "looking through the project's history",
          ),
        );
      case "add":
      case "commit":
        return make("git", "low", verb("save a version", "saved a version", "saving a version"));
      case "stash":
        return make(
          "git",
          "medium",
          verb(
            "set aside the unsaved changes",
            "set aside the unsaved changes",
            "setting aside the unsaved changes",
          ),
        );
      case "checkout":
      case "switch":
      case "restore":
        return make(
          "git",
          "medium",
          verb(
            "open a different version of the files",
            "opened a different version of the files",
            "opening a different version of the files",
          ),
          "only this project",
          { warning: "This can hide unsaved edits." },
        );
      case "branch":
      case "worktree":
      case "tag":
        return make(
          "git",
          "low",
          verb(
            "set up a draft line of work",
            "set up a draft line of work",
            "setting up a draft line of work",
          ),
        );
      case "fetch":
      case "remote":
        return make(
          "git",
          "low",
          verb(
            "check the online copy for updates",
            "checked the online copy for updates",
            "checking the online copy for updates",
          ),
          "the internet",
        );
      case "pull":
        return make(
          "git",
          "medium",
          verb(
            "bring down the latest changes from the online copy",
            "brought down the latest changes from the online copy",
            "bringing down the latest changes from the online copy",
          ),
          "the internet",
        );
      case "clone":
        return make(
          "git",
          "low",
          verb(
            "download a copy of a project",
            "downloaded a copy of a project",
            "downloading a copy of a project",
          ),
          "the internet",
        );
      case "push":
        if (forcePush) {
          return make(
            "git",
            "high",
            verb(
              "overwrite the online copy's history",
              "overwrote the online copy's history",
              "overwriting the online copy's history",
            ),
            "something live",
            {
              warning:
                "A force push rewrites history other people may already have. It can't be undone from here.",
            },
          );
        }
        if (toDefault) {
          return make(
            "git",
            "high",
            verb(
              "upload straight to the live version",
              "uploaded straight to the live version",
              "uploading straight to the live version",
            ),
            "something live",
            { warning: "This publishes to the version everyone sees, skipping review." },
          );
        }
        return make(
          "git",
          "medium",
          verb(
            "upload the saved versions to the online copy",
            "uploaded the saved versions to the online copy",
            "uploading the saved versions to the online copy",
          ),
          "the internet",
        );
      case "merge":
        return make(
          "git",
          "medium",
          verb(
            "combine two lines of work",
            "combined two lines of work",
            "combining two lines of work",
          ),
        );
      case "rebase":
      case "reset":
      case "clean":
      case "filter-branch":
      case "filter-repo":
        return make(
          "git",
          "high",
          verb(
            "rewrite or throw away part of the project's history",
            "rewrote part of the project's history",
            "rewriting part of the project's history",
          ),
          "only this project",
          { warning: "This can discard saved or unsaved work." },
        );
      default:
        return make(
          "git",
          "low",
          verb(
            "work with the project's history",
            "worked with the project's history",
            "working with the project's history",
          ),
        );
    }
  }

  if (PACKAGE_MANAGERS.has(base)) {
    const positional = installPositionals(args);
    const sub = positional[0] ?? "";
    if (base === "npx" || base === "pnpx" || base === "bunx") {
      const tool = positional[0] ?? "a tool";
      return make(
        "command",
        "medium",
        verb(`run the "${tool}" tool`, `ran the "${tool}" tool`, `running the "${tool}" tool`),
        "the internet",
        { warning: "This downloads and runs a tool from the internet." },
      );
    }
    if (INSTALL_SUBCOMMANDS.has(sub) || (base === "yarn" && sub === "")) {
      const packages = positional.slice(1).filter((p) => !/^(--?)/.test(p));
      if (packages.length === 0) {
        return make(
          "install",
          "medium",
          verb(
            "set up the add-ons the project already lists",
            "set up the add-ons the project already lists",
            "setting up the add-ons the project already lists",
          ),
          "the internet",
          { packages: [] },
        );
      }
      const described = joinList(packages.map(describePackage));
      const noun = pluralize(packages.length, "add-on");
      return make(
        "install",
        "medium",
        verb(
          `install ${noun}: ${described}`,
          `installed ${noun}: ${described}`,
          `installing ${noun}: ${described}`,
        ),
        "the internet",
        { packages },
      );
    }
    if (sub === "uninstall" || sub === "remove" || sub === "rm" || sub === "un") {
      const packages = positional.slice(1);
      return make(
        "install",
        "medium",
        verb(
          `remove ${pluralize(packages.length, "add-on")}`,
          `removed ${pluralize(packages.length, "add-on")}`,
          `removing ${pluralize(packages.length, "add-on")}`,
        ),
        "only this project",
        { packages },
      );
    }
    if (sub === "publish") {
      return make(
        "command",
        "high",
        verb(
          "publish a package to the public registry",
          "published a package to the public registry",
          "publishing a package to the public registry",
        ),
        "something live",
        { warning: "Publishing is public and hard to retract." },
      );
    }
    const runTarget =
      sub === "run" || sub === "run-script" || sub === "exec" ? (positional[1] ?? "") : sub;
    if (TEST_SUBCOMMANDS.has(runTarget))
      return make(
        "test",
        "low",
        verb(
          "run the project's checks",
          "ran the project's checks",
          "running the project's checks",
        ),
      );
    if (BUILD_SUBCOMMANDS.has(runTarget))
      return make(
        "test",
        "low",
        verb(
          "prepare the project for release",
          "prepared the project for release",
          "preparing the project for release",
        ),
      );
    if (LINT_SUBCOMMANDS.has(runTarget))
      return make(
        "test",
        "low",
        verb("run a style check", "ran a style check", "running a style check"),
      );
    if (TYPECHECK_SUBCOMMANDS.has(runTarget))
      return make(
        "test",
        "low",
        verb(
          "check the code fits together",
          "checked the code fits together",
          "checking the code fits together",
        ),
      );
    if (DEV_SUBCOMMANDS.has(runTarget))
      return make(
        "command",
        "low",
        verb("start the live preview", "started the live preview", "starting the live preview"),
      );
    if (runTarget)
      return make(
        "command",
        "low",
        verb(
          `run the project's "${runTarget}" task`,
          `ran the project's "${runTarget}" task`,
          `running the project's "${runTarget}" task`,
        ),
      );
    return make(
      "command",
      "low",
      verb("use the add-on manager", "used the add-on manager", "using the add-on manager"),
    );
  }

  if (
    base === "vitest" ||
    base === "jest" ||
    base === "mocha" ||
    base === "pytest" ||
    base === "rspec" ||
    base === "playwright" ||
    base === "cypress" ||
    (base === "vp" && stripFlags(args)[0] === "test")
  ) {
    return make(
      "test",
      "low",
      verb("run the project's checks", "ran the project's checks", "running the project's checks"),
    );
  }
  if (base === "tsc" || base === "tsc-rs" || base === "mypy" || base === "pyright") {
    return make(
      "test",
      "low",
      verb(
        "check the code fits together",
        "checked the code fits together",
        "checking the code fits together",
      ),
    );
  }
  if (
    base === "eslint" ||
    base === "prettier" ||
    base === "biome" ||
    base === "oxlint" ||
    base === "ruff" ||
    base === "black" ||
    base === "flake8" ||
    base === "rubocop"
  ) {
    return make(
      "test",
      "low",
      verb("run a style check", "ran a style check", "running a style check"),
    );
  }
  if (
    base === "vite" ||
    base === "next" ||
    base === "nuxt" ||
    base === "astro" ||
    base === "webpack" ||
    base === "esbuild" ||
    base === "rollup" ||
    base === "turbo" ||
    base === "vp"
  ) {
    const sub = stripFlags(args)[0] ?? "";
    if (BUILD_SUBCOMMANDS.has(sub))
      return make(
        "test",
        "low",
        verb(
          "prepare the project for release",
          "prepared the project for release",
          "preparing the project for release",
        ),
      );
    if (DEV_SUBCOMMANDS.has(sub) || sub === "")
      return make(
        "command",
        "low",
        verb("start the live preview", "started the live preview", "starting the live preview"),
      );
    return make(
      "command",
      "low",
      verb(
        `run the "${base} ${sub}" task`,
        `ran the "${base} ${sub}" task`,
        `running the "${base} ${sub}" task`,
      ),
    );
  }

  if (DELETE_PROGRAMS.has(base)) {
    const targets = stripFlags(args);
    const recursive = RM_RECURSIVE_FORCE_PATTERN.test(segment) || /\s-[a-zA-Z]*r/.test(segment);
    const dangerousPath = targets.some(
      (t) => DANGEROUS_PATHS_PATTERN.test(` ${t} `) || t.startsWith("/") || t.startsWith("~"),
    );
    const what =
      targets.length === 0
        ? "files"
        : targets.length === 1
          ? recursive
            ? `the "${humanizeFileName(targets[0]!)}" folder and everything in it`
            : describeFile(targets[0]!).noun
          : `${pluralize(targets.length, "file or folder", "files or folders")}`;
    // Every delete is a hard rule (QA2-03): high risk, once-only approval, however small.
    return make(
      "command",
      "high",
      verb(`delete ${what}`, `deleted ${what}`, `deleting ${what}`),
      dangerousPath ? "your computer" : "only this project",
      {
        warning: recursive
          ? "Deleting a folder removes everything inside it. This can't be undone from inside the app."
          : "Deleting can't be undone from inside the app.",
      },
    );
  }

  if (READ_PROGRAMS.has(base)) {
    // `head -n 40 menu.html`: the count is a flag value, not a file.
    const targets = stripFlags(args).filter((arg) => !arg.startsWith("$") && !/^\d+$/.test(arg));
    if (targets.some((target) => isOutsideProject(target, undefined))) {
      return make(
        "read",
        "medium",
        verb(
          "read a file outside your project",
          "read a file outside your project",
          "reading a file outside your project",
        ),
        "your computer",
      );
    }
    if (targets.length > 0 && /^(cat|head|tail|less|more|bat|stat|file)$/.test(base)) {
      return make("read", "low", lookAt(targets));
    }
    if (base === "wc") {
      const what = targets.length === 1 ? describeFile(targets[0]!).noun : "some files";
      return make(
        "read",
        "low",
        verb(
          `count the lines in ${what}`,
          `counted the lines in ${what}`,
          `counting the lines in ${what}`,
        ),
      );
    }
    if (base === "echo" || base === "printf") {
      return make(
        "read",
        "low",
        verb("print a message", "printed a message", "printing a message"),
      );
    }
    return make(
      "read",
      "low",
      verb(
        "look around the project files",
        "looked around the project files",
        "looking around the project files",
      ),
    );
  }
  if (SEARCH_PROGRAMS.has(base)) {
    if (stripFlags(args).some((target) => isOutsideProject(target, undefined))) {
      return make(
        "search",
        "medium",
        verb(
          "search files outside your project",
          "searched files outside your project",
          "searching files outside your project",
        ),
        "your computer",
      );
    }
    if (args.includes("--files")) {
      return make(
        "read",
        "low",
        verb(
          "list the project's files",
          "listed the project's files",
          "listing the project's files",
        ),
      );
    }
    const pattern = searchPattern(base, args);
    const what = pattern ? ` for "${pattern}"` : "";
    return make(
      "search",
      "low",
      verb(
        `search the project${what}`,
        `searched the project${what}`,
        `searching the project${what}`,
      ),
    );
  }
  if (
    base === "sed" &&
    args.includes("-n") &&
    !args.some((arg) => arg.startsWith("-i") || arg === "--in-place")
  ) {
    const targets = stripFlags(args).filter((arg) => /[./]/.test(arg) && !arg.startsWith("$"));
    return make(
      "read",
      "low",
      targets.length > 0
        ? lookAt(targets)
        : verb("look at part of a file", "looked at part of a file", "looking at part of a file"),
    );
  }

  if (base === "tee") {
    const files = stripFlags(args);
    if (files.length > 0) {
      return describeWrites(
        files,
        args.includes("-a") || args.includes("--append"),
        false,
        elevated,
        base,
      );
    }
  }
  if (base === "sed" && args.some((arg) => arg.startsWith("-i") || arg === "--in-place")) {
    // `sed -i 's/a/b/' page.html`: the script is the first word that is not a file.
    const files = stripFlags(args).filter((arg) => /[./]/.test(arg) && !/^s(.).*\1/.test(arg));
    const what =
      files.length === 0
        ? "a file"
        : joinList([...new Set(files.map((f) => describeFile(f).noun))]);
    return make("edit", "low", verb(`change ${what}`, `changed ${what}`, `changing ${what}`));
  }
  if (FILE_PROGRAMS.has(base)) {
    const v =
      base === "mkdir"
        ? verb("create a folder", "created a folder", "creating a folder")
        : base === "touch"
          ? verb("create an empty file", "created an empty file", "creating an empty file")
          : base === "mv"
            ? verb("move or rename files", "moved or renamed files", "moving or renaming files")
            : base === "cp"
              ? verb("copy files", "copied files", "copying files")
              : base === "chmod" || base === "chown"
                ? verb(
                    "change who can open some files",
                    "changed who can open some files",
                    "changing who can open some files",
                  )
                : verb("rearrange some files", "rearranged some files", "rearranging some files");
    return make("edit", base === "chmod" || base === "chown" ? "medium" : "low", v);
  }

  if (PIPE_TO_SHELL_PATTERN.test(segment) && (base === "curl" || base === "wget")) {
    return make(
      "web",
      "high",
      verb(
        "download a script from the internet and run it straight away",
        "downloaded and ran a script from the internet",
        "downloading and running a script from the internet",
      ),
      "your computer",
      {
        warning:
          "Running a downloaded script without looking at it first is how computers get compromised.",
      },
    );
  }

  if (DEPLOY_PROGRAMS.has(base)) {
    const sub = stripFlags(args)[0] ?? "";
    const deploys =
      /^(deploy|publish|release|apply|up|launch|rollout|prod|promote)$/.test(sub) || sub === "";
    if (deploys) {
      return make(
        "command",
        "high",
        verb(
          `put the project live with ${base}`,
          `put the project live with ${base}`,
          `putting the project live with ${base}`,
        ),
        "something live",
        { warning: "This changes what your customers see." },
      );
    }
    return make(
      "command",
      "medium",
      verb(`use ${base}`, `used ${base}`, `using ${base}`),
      "the internet",
    );
  }

  if (NETWORK_PROGRAMS.has(base)) {
    if (PAYMENT_PATTERN.test(segment)) {
      return make(
        "web",
        "high",
        verb(
          "talk to a payments service",
          "talked to a payments service",
          "talking to a payments service",
        ),
        "something live",
        { warning: "This may move real money." },
      );
    }
    const method = /(-X|--request)\s+(POST|PUT|PATCH|DELETE)/i.exec(segment)?.[2]?.toUpperCase();
    const sends =
      method !== undefined || /\s(-d|--data[^\s]*|-F|--form|--upload-file|-T)\b/.test(segment);
    const url = args.find((a) => /^https?:\/\//.test(a));
    const host = url ? new URL(url).hostname : undefined;
    const where = host ? ` (${host})` : "";
    if (base === "ssh" || base === "scp" || base === "rsync" || base === "sftp") {
      return make(
        "web",
        "medium",
        verb(
          "connect to another computer",
          "connected to another computer",
          "connecting to another computer",
        ),
        "the internet",
      );
    }
    if (sends) {
      return make(
        "web",
        "medium",
        verb(
          `send something to a web address${where}`,
          `sent something to a web address${where}`,
          `sending something to a web address${where}`,
        ),
        "the internet",
      );
    }
    return make(
      "web",
      "low",
      verb(
        `fetch something from the internet${where}`,
        `fetched something from the internet${where}`,
        `fetching something from the internet${where}`,
      ),
      "the internet",
    );
  }

  if (CONTAINER_PROGRAMS.has(base)) {
    const sub = stripFlags(args)[0] ?? "";
    if (/^(rm|rmi|prune|system|delete|down)$/.test(sub)) {
      return make(
        "command",
        "high",
        verb(
          "remove containers or their data",
          "removed containers or their data",
          "removing containers or their data",
        ),
        "your computer",
        { warning: "This can delete data stored in containers." },
      );
    }
    return make(
      "command",
      "medium",
      verb(
        "work with containers (self-contained mini computers)",
        "worked with containers (self-contained mini computers)",
        "working with containers (self-contained mini computers)",
      ),
      "your computer",
    );
  }

  if (SYSTEM_PACKAGE_MANAGERS.has(base)) {
    const positional = stripFlags(args);
    const sub = positional[0] ?? "";
    if (INSTALL_SUBCOMMANDS.has(sub) || sub === "get" || sub === "-S") {
      const packages = positional.slice(1);
      return make(
        "install",
        "medium",
        verb(
          `install ${pluralize(Math.max(packages.length, 1), "program")} on this computer`,
          `installed ${pluralize(Math.max(packages.length, 1), "program")} on this computer`,
          `installing ${pluralize(Math.max(packages.length, 1), "program")} on this computer`,
        ),
        "your computer",
        { packages },
      );
    }
    return make(
      "command",
      "medium",
      verb(
        `use the ${base} program manager`,
        `used the ${base} program manager`,
        `using the ${base} program manager`,
      ),
      "your computer",
    );
  }

  if (
    base === "psql" ||
    base === "mysql" ||
    base === "sqlite3" ||
    base === "mongosh" ||
    base === "redis-cli" ||
    base === "prisma" ||
    base === "drizzle-kit" ||
    base === "knex" ||
    base === "sequelize"
  ) {
    if (
      SQL_DESTRUCTIVE_PATTERN.test(segment) ||
      /\b(db\s+)?(reset|drop|wipe|flushall|flushdb|migrate\s+reset)\b/i.test(segment)
    ) {
      return make(
        "command",
        "high",
        verb(
          "wipe data from the database",
          "wiped data from the database",
          "wiping data from the database",
        ),
        "something live",
        { warning: "Deleting database data is permanent." },
      );
    }
    return make(
      "command",
      "medium",
      verb("work with the database", "worked with the database", "working with the database"),
      "only this project",
    );
  }

  if (base === "open" || base === "xdg-open" || base === "start") {
    return make(
      "other",
      "low",
      verb(
        "open something on this computer",
        "opened something on this computer",
        "opening something on this computer",
      ),
      "your computer",
    );
  }
  if (base === "kill" || base === "killall" || base === "pkill") {
    return make(
      "command",
      "medium",
      verb("stop a running program", "stopped a running program", "stopping a running program"),
      "your computer",
    );
  }
  if (
    base === "make" ||
    base === "cmake" ||
    base === "gradle" ||
    base === "gradlew" ||
    base === "./gradlew" ||
    base === "mvn" ||
    base === "xcodebuild"
  ) {
    return make(
      "test",
      "low",
      verb(
        "prepare the project for release",
        "prepared the project for release",
        "preparing the project for release",
      ),
    );
  }
  // `python3 -m http.server 8765`, `php -S localhost:8000`: a preview of the site on this Mac.
  if (
    ((base === "python" || base === "python3" || base === "py") &&
      /(^|\s)-m\s+(http\.server|SimpleHTTPServer)\b/.test(segment)) ||
    (base === "php" && args.includes("-S"))
  ) {
    return make(
      "command",
      "low",
      verb(
        "start a local preview of the site",
        "started a local preview of the site",
        "starting a local preview of the site",
      ),
    );
  }
  if (SCRIPT_PROGRAMS.has(base)) {
    // `python3 -c "…"`, `node -e "…"` and quoted one-liners are inline code, not a file.
    const inline = args.some((arg) => /^(-c|-e|--eval|-p|--print)$/.test(arg));
    const script = inline ? undefined : stripFlags(args).find((arg) => !/\s/.test(arg));
    const what = script ? `the "${humanizeFileName(script)}" script` : `a short ${base} program`;
    if (PAYMENT_PATTERN.test(segment)) {
      return make(
        "command",
        "high",
        verb(
          `run ${what}, which talks to a payments service`,
          `ran ${what}, which talks to a payments service`,
          `running ${what}, which talks to a payments service`,
        ),
        "something live",
        { warning: "This may move real money." },
      );
    }
    return make("command", "medium", verb(`run ${what}`, `ran ${what}`, `running ${what}`));
  }

  if (SQL_DESTRUCTIVE_PATTERN.test(segment)) {
    return make(
      "command",
      "high",
      verb(
        "wipe data from the database",
        "wiped data from the database",
        "wiping data from the database",
      ),
      "something live",
      { warning: "Deleting database data is permanent." },
    );
  }

  return make("command", "medium", verb(`run "${base}"`, `ran "${base}"`, `running "${base}"`));
}

const RISK_ORDER: Record<CommandRisk, number> = { low: 0, medium: 1, high: 2 };
const TOUCH_ORDER: Record<CommandClassification["touches"], number> = {
  "only this project": 0,
  "your computer": 1,
  "the internet": 2,
  "something live": 3,
};

const PRINTS = new Set(["print a message"]);

/** `head x > /dev/null`, `cmd 2>&1`: where the output goes is not a file the step touches. */
function withoutQuietRedirects(segment: string): string {
  return segment.replace(/\s+\d*>{1,2}\s*(?:\/dev\/null|&\d)(?=\s|$)/g, "");
}

/** Read-only steps a check loop is made of. */
const CHECK_KINDS: ReadonlySet<NarrationKind> = new Set<NarrationKind>(["read", "search", "test"]);
const LOOP_PLUMBING = /^(if|then|else|elif|fi|test|\[|true|false|echo|printf|:)$/;

/**
 * `for f in *.html; do curl --fail "file://…/$f"; printf PASS; done` is one
 * intent — "checked every page" — not "printed a message" twice (QA-P2-2-13).
 * Only read-only loops are folded; anything that changes files keeps its steps.
 */
function describeReadOnlyLoop(command: string): CommandClassification | null {
  const match = /^for\s+(\w+)\s+in\s+(.+?);\s*do\s+([\s\S]+?);?\s*done\s*$/.exec(command);
  if (match === null) return null;
  const list = match[2]!.trim();
  const body = match[3]!;
  const steps = splitShellSegments(body.replace(/\b(then|else|do)\b/g, ";"))
    // `if curl …; then`: the test after `if` is the step.
    .map((segment) => segment.trim().replace(/^(if|elif|while|until)\s+/, ""))
    .filter((segment) => segment.length > 0)
    .filter((segment) => !LOOP_PLUMBING.test(segment.split(/\s+/)[0] ?? ""))
    // `failed=1`: the loop keeping score, not a step.
    .filter((segment) => !/^\w+=\S*$/.test(segment));
  const looksAtFiles = steps.every((segment) => {
    if (/^curl\b/.test(segment)) return /file:\/\//.test(segment) && !/\s-(o|O)\b/.test(segment);
    const classified = classifySegment(withoutQuietRedirects(segment));
    return classified !== null && CHECK_KINDS.has(classified.kind) && classified.risk === "low";
  });
  if (!looksAtFiles) return null;
  // A loop that only shows files (`cat "$f"`) is reading, not checking.
  const checks =
    /\/dev\/null|\b(PASS|FAIL|OK|opens?)\b/.test(body) ||
    steps.some((segment) => /^(curl|test|\[)/.test(segment));
  if (!checks) return null;
  const items = list.split(/\s+/).filter((item) => item.length > 0);
  const pages = items.every((item) => /\.html?$/i.test(item));
  const what =
    items.length === 1 && /\*/.test(items[0]!)
      ? pages
        ? "every page"
        : "every matching file"
      : pages
        ? pluralize(items.length, "page")
        : pluralize(items.length, "file");
  const opens = steps.some((segment) => /^(curl|head|test|\[)/.test(segment)) || steps.length === 0;
  const tail = opens ? (what === "every page" ? " opens" : " open") : "";
  return {
    kind: "test",
    risk: "low",
    past: `Checked that ${what}${tail}`,
    present: `Checking that ${what}${tail}`,
    infinitive: `check that ${what}${tail}`,
    program: "for",
    touches: "only this project",
  };
}

/**
 * Narrates a shell command in plain English and grades its risk. Multi-step commands
 * (`a && b`) report the riskiest step's risk and list the steps.
 */
export function classifyCommand(command: string): CommandClassification {
  const unwrapped = unwrapShellWrapper(command.trim());
  const trimmed = unwrapped.replace(HEREDOC_PATTERN, (_match, _quote, rest: string) => rest).trim();
  const whole = SQL_DESTRUCTIVE_PATTERN.test(trimmed) || PIPE_TO_SHELL_PATTERN.test(trimmed);
  // `failed=0; for …; done; exit "$failed"`: the score-keeping around a loop is not a step.
  const loop = describeReadOnlyLoop(
    trimmed
      .replace(/^(\w+=\S*\s*[;\n]\s*)+/, "")
      .replace(/[;\n]\s*exit\b[^;\n]*$/, "")
      .trim(),
  );
  if (loop !== null && !whole) return loop;
  const all = splitShellSegments(trimmed)
    .map((segment) => classifySegment(withoutQuietRedirects(segment)))
    .filter((c): c is CommandClassification => c !== null);
  // `echo done`, `printf 'PASS'` next to real work is plumbing, not a step; and
  // `pwd; rg --files` is one look around, not "looked around … and looked around …".
  const work = all.filter((c) => !PRINTS.has(c.infinitive) && c.program !== "pwd");
  const seen = new Set<string>();
  const classified = (work.length > 0 ? work : all).filter((c) => {
    if (seen.has(c.infinitive)) return false;
    seen.add(c.infinitive);
    return true;
  });
  if (classified.length === 0) {
    return {
      kind: "command",
      risk: "medium",
      past: "Ran a command",
      present: "Running a command",
      infinitive: "run a command",
      program: null,
      touches: "only this project",
    };
  }
  if (classified.length === 1) {
    const only = classified[0]!;
    if (whole && only.risk !== "high") {
      return {
        ...only,
        risk: "high",
        warning:
          only.warning ??
          (PIPE_TO_SHELL_PATTERN.test(trimmed)
            ? "Pipes a download straight into a shell."
            : "Wipes database data."),
      };
    }
    return only;
  }
  const riskiest = classified.reduce((a, b) => (RISK_ORDER[b.risk] > RISK_ORDER[a.risk] ? b : a));
  const touches = classified.reduce((a, b) =>
    TOUCH_ORDER[b.touches] > TOUCH_ORDER[a.touches] ? b : a,
  ).touches;
  const steps = classified.map((c) => c.infinitive);
  const lower = (text: string) =>
    text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
  const kinds = new Set(classified.map((c) => c.kind));
  const kind: NarrationKind =
    kinds.size === 1
      ? classified[0]!.kind
      : riskiest.kind === "command"
        ? "command"
        : riskiest.kind;
  const packages = classified.flatMap((c) => c.packages ?? []);
  return {
    kind,
    risk: whole && riskiest.risk !== "high" ? "high" : riskiest.risk,
    past: `Ran ${pluralize(steps.length, "step")}: ${joinList(classified.map((c) => lower(c.past)))}`,
    present: `Running ${pluralize(steps.length, "step")}: ${joinList(classified.map((c) => lower(c.present)))}`,
    infinitive: `run ${pluralize(steps.length, "step")}: ${joinList(steps)}`,
    program: classified[0]!.program,
    touches,
    ...(riskiest.warning ? { warning: riskiest.warning } : {}),
    ...(packages.length > 0 ? { packages } : {}),
  };
}

export function narrationStatus(
  status: OrchestrationV2TurnItemStatus,
  options: {
    readonly streaming?: boolean | undefined;
    readonly decision?: ProviderApprovalDecision | undefined;
  } = {},
): NarrationStatus {
  if (options.decision === "decline" || options.decision === "cancel") return "denied";
  switch (status) {
    case "pending":
      return "pending";
    case "running":
    case "waiting":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "denied";
    case "idle":
      return options.streaming ? "running" : "done";
  }
}

function withOutcome(
  headline: string,
  status: NarrationStatus,
  item: {
    readonly exitCode?: number | undefined;
    readonly outputIndicatesFailure?: boolean | undefined;
  },
): string {
  if (status === "done" && item.exitCode !== undefined && item.exitCode !== 0)
    return `${headline} (found problems)`;
  if (status === "done" && item.outputIndicatesFailure) return `${headline} (found problems)`;
  if (status === "done") return `${headline} (passed)`;
  if (status === "failed") return `${headline} (didn't finish)`;
  return headline;
}

function firstLine(text: string, max = 140): string {
  const line =
    text
      .split(/\r?\n/)
      .find((l) => l.trim().length > 0)
      ?.trim() ?? "";
  const clean = line.replace(/^#+\s*/, "").replace(/[*_`]/g, "");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function fileOperation(
  item: Extract<OrchestrationV2TurnItem, { type: "file_change" }>,
): "added" | "deleted" | "renamed" | "edited" {
  const op = item.changes?.[0]?.operation?.toLowerCase() ?? "";
  if (/^(a|add|added|create|created|new|write)$/.test(op)) return "added";
  if (/^(d|del|delete|deleted|remove|removed)$/.test(op)) return "deleted";
  if (/^(r\d*|rename|renamed|move|moved)$/.test(op)) return "renamed";
  if (
    item.additions !== undefined &&
    item.additions > 0 &&
    item.deletions === 0 &&
    op === "" &&
    item.oldStr === ""
  )
    return "added";
  return "edited";
}

/**
 * "at 11:15 pm" / "on Thu at 9:00 am" from whichever field carries the reset:
 * the failure's own time, the thread's note, or the provider's words ("try
 * again at 11:15 PM", "resets in 2 hours"). Undefined when nothing says.
 */
export function describeResetTime(
  resetAt: string | null,
  message: string,
  now: Date = new Date(),
): string | undefined {
  if (resetAt !== null) {
    const date = new Date(resetAt);
    if (!Number.isNaN(date.getTime()) && date.getTime() > now.getTime() - 60_000) {
      const time = date
        .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        .toLowerCase();
      return date.toDateString() === now.toDateString()
        ? `at ${time}`
        : `on ${date.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
    }
  }
  const spoken =
    /\b(?:try again|resets?|available again|renews?)\s+(at\s+\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*\([^)]*\))?|in\s+(?:about\s+)?\d+\s+(?:minutes?|hours?|days?)|on\s+[A-Z][a-z]+(?:\s+\d{1,2})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?|tomorrow)/i.exec(
      message,
    );
  return spoken
    ? spoken[1]!
        .replace(/\s+/g, " ")
        .trim()
        .replace(/(?<![ap]\.m)\.$/i, "")
    : undefined;
}

/** Marks a headline for a step that never ran; `describeTurnItem` words it for the context. */
const DID_NOT_RUN = "\u0000did-not-run:";

/** Verb pairs: [past, present] keyed by what a tense needs. */
function tense(status: NarrationStatus, past: string, present: string, future: string): string {
  if (status === "pending") return future;
  if (status === "running") return present;
  // A refused or cancelled step never happened: never say it in the past tense.
  if (status === "denied") return `${DID_NOT_RUN}${future.replace(/^About to /, "")}`;
  return past;
}

/**
 * "Asked to delete the book page — you said no" / "Cancelled: delete the book
 * page", so Show details never narrates a refused step as if it happened.
 */
export function describeTurnItem(
  item: OrchestrationV2TurnItem,
  ctx: NarrationContext = {},
): Narration {
  const narrated = narrateTurnItem(item, ctx);
  const narration =
    ctx.kid === true ? { ...narrated, headline: kidNouns(narrated.headline) } : narrated;
  if (!narration.headline.startsWith(DID_NOT_RUN)) return narration;
  const what = narration.headline.slice(DID_NOT_RUN.length);
  return {
    ...narration,
    headline: ctx.stopped ? `Cancelled: ${what}` : `Asked to ${what} — you said no`,
  };
}

function narrateTurnItem(item: OrchestrationV2TurnItem, ctx: NarrationContext): Narration {
  const base = (status: NarrationStatus) => status;
  switch (item.type) {
    case "user_message": {
      const headline =
        item.inputIntent === "steer" || item.inputIntent === "promoted_queued_to_steer"
          ? "You added a note mid-task"
          : item.inputIntent === "queued_turn"
            ? "You lined up a message for later"
            : "You asked";
      return {
        headline,
        detail: firstLine(item.text),
        kind: "message",
        status: "done",
        technical: item.text,
      };
    }
    case "assistant_message": {
      const status = item.streaming ? "running" : narrationStatus(item.status);
      return {
        headline: status === "running" ? "The assistant is replying" : "The assistant replied",
        detail: firstLine(item.text),
        kind: "message",
        status,
        technical: item.text,
      };
    }
    case "reasoning": {
      const status = item.streaming ? "running" : narrationStatus(item.status);
      return {
        headline: status === "running" ? "Thinking it through" : "Thought it through",
        detail: firstLine(item.text),
        kind: "reasoning",
        status,
        technical: item.text,
      };
    }
    case "proposed_plan": {
      const status = item.streaming ? "running" : narrationStatus(item.status);
      return {
        headline:
          status === "running"
            ? "Writing a plan for you to approve"
            : "Wrote a plan for you to approve",
        detail: "Nothing changes until you say go.",
        kind: "message",
        status,
        technical: item.markdown,
      };
    }
    case "todo_list": {
      const done = item.steps.filter((s) => s.status === "completed").length;
      const running = item.steps.find((s) => s.status === "running");
      return {
        headline: `Working through ${pluralize(item.steps.length, "step")} (${done} done)`,
        detail: running
          ? `Now: ${running.text}`
          : item.explanation
            ? firstLine(item.explanation)
            : undefined,
        kind: "message",
        status: done === item.steps.length ? "done" : "running",
        technical: item.steps.map((s) => `[${s.status}] ${s.text}`).join("\n"),
      };
    }
    case "user_input_request": {
      const status = narrationStatus(item.status);
      const count = item.questions.length;
      return {
        headline:
          status === "done"
            ? "You answered the assistant's question"
            : status === "denied"
              ? "You skipped the assistant's question"
              : `The assistant has ${count === 1 ? "a question" : `${count} questions`} for you`,
        detail: item.questions[0] ? firstLine(item.questions[0].question) : undefined,
        kind: "message",
        status: status === "running" || status === "pending" ? "pending" : status,
        technical: item.questions.map((q) => `${q.header}: ${q.question}`).join("\n"),
      };
    }
    case "file_change": {
      const described = describeFile(item.fileName);
      const op = ctx.deletedPaths?.has(item.fileName) ? "deleted" : fileOperation(item);
      const status = narrationStatus(item.status);
      const verbFor = (past: string, present: string, future: string) =>
        tense(status, past, present, future);
      const headline =
        op === "added"
          ? verbFor(
              `Added ${described.noun}`,
              `Adding ${described.noun}`,
              `About to add ${described.noun}`,
            )
          : op === "deleted"
            ? verbFor(
                `Deleted ${described.noun}`,
                `Deleting ${described.noun}`,
                `About to delete ${described.noun}`,
              )
            : op === "renamed"
              ? verbFor(
                  `Renamed ${described.noun}`,
                  `Renaming ${described.noun}`,
                  `About to rename ${described.noun}`,
                )
              : verbFor(
                  `Edited ${described.noun}`,
                  `Editing ${described.noun}`,
                  `About to edit ${described.noun}`,
                );
      const size =
        item.additions !== undefined || item.deletions !== undefined
          ? `+${item.additions ?? 0} / −${item.deletions ?? 0} lines`
          : undefined;
      const detail =
        status === "failed"
          ? `The edit didn't apply.${item.diffStr ? " Details below." : ""}`
          : [size, item.title ?? undefined].filter(Boolean).join(" · ") || undefined;
      return {
        headline,
        detail,
        kind: "edit",
        status,
        technical: item.fileName,
        risk: op === "deleted" || described.isConfigOrSecret ? "medium" : "low",
      };
    }
    case "command_execution": {
      // The engine logs its own worktree set-up as a command named "Preparing workspace".
      if (/^preparing workspace$/i.test(item.input.trim())) {
        const status = narrationStatus(item.status);
        return {
          headline: tense(
            status,
            "Made a private copy of the project",
            "Making a private copy of the project",
            "About to make a private copy of the project",
          ),
          kind: "other",
          status,
          technical: item.output?.trim() || item.input,
        };
      }
      const classified = classifyCommand(item.input);
      const status = narrationStatus(item.status);
      // A child's lines say "Testing your game", not "Running a short node program".
      const kid = ctx.kid === true ? kidStep(classified, ctx.kidThing ?? "page") : null;
      const said = kid ?? classified;
      const bare = tense(status, said.past, said.present, `About to ${said.infinitive}`);
      const headline =
        classified.kind === "test" && status !== "pending" && status !== "running"
          ? kid !== null
            ? kidTestOutcome(bare, status, item)
            : withOutcome(bare, status, item)
          : status === "done" && (item.exitCode ?? 0) !== 0
            ? `${bare} (didn't go to plan)`
            : status === "failed"
              ? // "Started a local preview" must not be said of a server the sandbox blocked.
                `Tried to ${said.infinitive} — it didn't work`
              : bare;
      return {
        headline,
        detail: classified.warning,
        kind: classified.kind,
        status,
        technical: item.input,
        risk: classified.risk,
      };
    }
    case "file_search": {
      const status = narrationStatus(item.status);
      const count = item.results?.length;
      const what = item.pattern ? ` for "${item.pattern}"` : "";
      const headline =
        status === "done" && count !== undefined
          ? `Searched the project${what} — ${pluralize(count, "match", "matches")}`
          : tense(
              status,
              `Searched the project${what}`,
              `Searching the project${what}`,
              `About to search the project${what}`,
            );
      return { headline, kind: "search", status, technical: item.pattern ?? "file search" };
    }
    case "web_search": {
      const status = narrationStatus(item.status);
      const queries = item.patterns ?? [];
      const what = queries[0] ? ` for "${queries[0]}"` : "";
      const count = item.results?.length;
      return {
        headline:
          status === "done" && count !== undefined
            ? `Searched the web${what} — ${pluralize(count, "result")}`
            : tense(
                status,
                `Searched the web${what}`,
                `Searching the web${what}`,
                `About to search the web${what}`,
              ),
        detail: item.results?.[0]?.title ? `Top result: ${item.results[0].title}` : undefined,
        kind: "web",
        status,
        technical: queries.join("\n") || "web search",
      };
    }
    case "approval_request": {
      const request = ctx.runtimeRequests?.get(item.requestId);
      const status = narrationStatus(item.status, { decision: request?.decision });
      const key = commandInputKey(item.nativeItemRef);
      const ask =
        item.requestKind === "command"
          ? readCommandAsk({
              driver: item.nativeItemRef?.driver,
              prompt: item.prompt,
              toolCallInput: key === null ? undefined : ctx.commandInputs?.get(key),
            })
          : null;
      const outsideSafeArea = ask?.leavesSandbox === true ? " outside its safe area" : "";
      const subject =
        ask !== null
          ? ask.command
            ? `${classifyCommand(ask.command).infinitive}${outsideSafeArea}`
            : ask.leavesSandbox
              ? "run a step outside its safe area"
              : "run a command"
          : item.requestKind === "file-change"
            ? `change ${item.prompt ? describeFile(firstLine(item.prompt, 400)).noun : "a file"}`
            : item.requestKind === "file-read"
              ? `read ${item.prompt ? describeFile(firstLine(item.prompt, 400)).noun : "a file"}`
              : item.requestKind === "mcp-elicitation" || item.requestKind === "permission"
                ? ownToolAsk(item)
                : "do something";
      const policy = readPolicyDecision(request?.answers);
      const headline =
        status === "done"
          ? policy !== null
            ? `SKYCOT rules allowed the assistant to ${subject}`
            : `You allowed the assistant to ${subject}`
          : status === "denied"
            ? `You said no to: ${subject}`
            : `The assistant wants to ${subject}`;
      const classified = ask?.command ? classifyCommand(ask.command) : undefined;
      return {
        headline,
        detail: policy !== null && status === "done" ? policy.note : classified?.warning,
        kind:
          item.requestKind === "command"
            ? (classified?.kind ?? "command")
            : item.requestKind === "file-change"
              ? "edit"
              : item.requestKind === "file-read"
                ? "read"
                : "other",
        status: status === "running" ? "pending" : status,
        technical:
          ask?.sandboxReason !== undefined
            ? `${ask.command ?? ""}\n(asked to run outside the safe area: ${ask.sandboxReason})`.trim()
            : (ask?.command ?? item.prompt ?? item.requestKind),
        ...(classified ? { risk: classified.risk } : {}),
      };
    }
    case "checkpoint": {
      const count = item.files.length;
      return {
        headline: `Saved a restore point (${pluralize(count, "file")} changed)`,
        detail: "You can come back to this point from Versions.",
        kind: "other",
        status: narrationStatus(item.status),
        technical: item.files.map((f) => f.path).join("\n"),
      };
    }
    case "run_interrupt_request":
      return {
        headline: "You asked the assistant to stop",
        detail: firstLine(item.message),
        kind: "message",
        status: "done",
        technical: item.message,
      };
    case "run_interrupt_result":
      return {
        headline: "The assistant stopped",
        detail: firstLine(item.message),
        kind: "message",
        status: "done",
        technical: item.message,
      };
    case "system_notice":
      return {
        headline: "A note from the app",
        detail: firstLine(item.message),
        kind: "message",
        status: "done",
        technical: item.message,
      };
    case "error": {
      const failure = item.failure;
      const headline =
        failure.class === "usage_limit"
          ? errors.usageLimit(
              describeResetTime(failure.resetAt ?? ctx.usageLimitResetAt ?? null, failure.message),
            )
          : failure.class === "transport_error"
            ? item.retry?.retryDelayMs !== undefined && item.retry.retryDelayMs !== null
              ? errors.didNotRespond(
                  "The assistant's service",
                  Math.round(item.retry.retryDelayMs / 1000),
                )
              : errors.didNotRespond("The assistant's service")
            : failure.class === "permission_error"
              ? errors.permission
              : errors.somethingWentWrong("That step");
      return {
        headline,
        detail: item.retry
          ? `Attempt ${item.retry.attempt}${item.retry.maxAttempts ? ` of ${item.retry.maxAttempts}` : ""}.`
          : failure.retryable
            ? "The assistant will try again."
            : undefined,
        kind: "other",
        status: "failed",
        technical: `${failure.class}${failure.code ? ` (${failure.code})` : ""}: ${failure.message}`,
      };
    }
    case "compaction": {
      const status = narrationStatus(item.status);
      return {
        headline: tense(
          status,
          "Tidied its memory of this conversation",
          "Tidying its memory of this conversation",
          "About to tidy its memory",
        ),
        detail: "Older details are summarised. Restate anything important.",
        kind: "other",
        status,
        technical:
          item.summary ??
          `compaction ${item.beforeTokenCount ?? "?"} → ${item.afterTokenCount ?? "?"} tokens`,
      };
    }
    case "handoff": {
      const status = narrationStatus(item.status);
      return {
        headline: tense(
          status,
          `Handed the conversation to ${item.toModel ?? "another assistant"}`,
          `Handing the conversation to ${item.toModel ?? "another assistant"}`,
          "About to hand over the conversation",
        ),
        detail: "The new assistant gets a summary, not every detail.",
        kind: "other",
        status,
        technical: `${item.strategy}: ${item.fromProviderInstanceIds.join(", ")} → ${item.toProviderInstanceId}`,
      };
    }
    case "fork":
      return {
        headline: "Started a side conversation from here",
        kind: "other",
        status: narrationStatus(item.status),
        technical: `fork → ${item.targetThreadId}`,
      };
    case "thread_created":
      return {
        headline: "Started a new conversation",
        detail: `With ${item.targetModel}.`,
        kind: "subagent",
        status: narrationStatus(item.status),
        technical: `thread ${item.targetThreadId} (${item.targetModel})`,
      };
    case "secret_request": {
      const status: NarrationStatus =
        item.secretStatus === "saved"
          ? "done"
          : item.secretStatus === "declined" || item.secretStatus === "cancelled"
            ? "denied"
            : "pending";
      return {
        headline:
          status === "pending"
            ? `The assistant needs a key: ${item.label}`
            : status === "done"
              ? `You saved the ${item.label} key securely`
              : `You didn't share the ${item.label} key`,
        detail: firstLine(item.reason),
        kind: "other",
        status,
        technical: item.label,
        risk: "medium",
      };
    }
    case "subagent": {
      const status = narrationStatus(item.status);
      return {
        headline: tense(
          status,
          "A helper finished a side task",
          "A helper is working on a side task",
          "About to hand a side task to a helper",
        ),
        detail: firstLine(item.progress ?? item.result ?? item.prompt),
        kind: "subagent",
        status,
        technical: item.prompt,
      };
    }
    case "dynamic_tool": {
      const status = narrationStatus(item.status);
      const name = item.toolName ?? "a tool";
      const ownTool = ownToolName(item.toolName);
      if (ownTool !== null) {
        const what = describeOwnTool(ownTool);
        return {
          headline: tense(status, what.past, what.present, `About to ${what.infinitive}`),
          kind: "other",
          status,
          technical: withSkycotName(name),
        };
      }
      const lower = name.toLowerCase();
      const input = item.input as Record<string, unknown> | undefined;
      const path =
        typeof input?.path === "string"
          ? input.path
          : typeof input?.file_path === "string"
            ? input.file_path
            : typeof input?.filePath === "string"
              ? input.filePath
              : undefined;
      if (item.viewedImagePath) {
        return {
          headline: tense(
            status,
            `Looked at ${describeFile(item.viewedImagePath).noun}`,
            `Looking at ${describeFile(item.viewedImagePath).noun}`,
            "About to look at an image",
          ),
          kind: "read",
          status,
          technical: item.viewedImagePath,
        };
      }
      if (/(^|_)(read|view|cat|open_file|get_file)/.test(lower)) {
        const noun = path ? describeFile(path).noun : "a file";
        return {
          headline: tense(status, `Read ${noun}`, `Reading ${noun}`, `About to read ${noun}`),
          kind: "read",
          status,
          technical: path ?? name,
        };
      }
      if (/todo|plan/.test(lower)) {
        return {
          headline: tense(
            status,
            "Updated its to-do list",
            "Updating its to-do list",
            "About to update its to-do list",
          ),
          kind: "message",
          status,
          technical: name,
        };
      }
      if (/write|edit|create_file|replace|patch|multi_?edit|notebook_?edit/.test(lower)) {
        const noun = path ? describeFile(path).noun : "a file";
        return {
          headline: tense(status, `Edited ${noun}`, `Editing ${noun}`, `About to edit ${noun}`),
          kind: "edit",
          status,
          technical: path ?? name,
        };
      }
      if (/bash|shell|exec|terminal|command|run_command|powershell/.test(lower)) {
        const command = typeof input?.command === "string" ? input.command : undefined;
        if (command) {
          const classified = classifyCommand(command);
          return {
            headline: tense(
              status,
              classified.past,
              classified.present,
              `About to ${classified.infinitive}`,
            ),
            detail: classified.warning,
            kind: classified.kind,
            status,
            technical: command,
            risk: classified.risk,
          };
        }
        return {
          headline: tense(status, "Ran a command", "Running a command", "About to run a command"),
          kind: "command",
          status,
          technical: name,
          risk: "medium",
        };
      }
      if (/grep|glob|search|find|ls|list_dir|list_files/.test(lower) && !/web/.test(lower)) {
        const pattern =
          typeof input?.pattern === "string"
            ? input.pattern
            : typeof input?.query === "string"
              ? input.query
              : undefined;
        const what = pattern ? ` for "${pattern}"` : "";
        return {
          headline: tense(
            status,
            `Searched the project${what}`,
            `Searching the project${what}`,
            `About to search the project${what}`,
          ),
          kind: "search",
          status,
          technical: pattern ?? name,
        };
      }
      if (/web|fetch|browse|http|url|navigate|screenshot|click|browser/.test(lower)) {
        const url = typeof input?.url === "string" ? input.url : undefined;
        const host = url && /^https?:\/\//.test(url) ? new URL(url).hostname : undefined;
        return {
          headline: tense(
            status,
            `Looked something up on the web${host ? ` (${host})` : ""}`,
            `Looking something up on the web${host ? ` (${host})` : ""}`,
            "About to look something up on the web",
          ),
          kind: "web",
          status,
          technical: url ?? name,
        };
      }
      if (/task|agent|delegate|subagent/.test(lower)) {
        return {
          headline: tense(
            status,
            "A helper finished a side task",
            "A helper is working on a side task",
            "About to hand off a side task",
          ),
          detail: typeof input?.description === "string" ? firstLine(input.description) : undefined,
          kind: "subagent",
          status,
          technical: name,
        };
      }
      if (/skill/.test(lower)) {
        const skill = typeof input?.skill === "string" ? input.skill : undefined;
        return {
          headline: tense(
            status,
            `Followed the "${skill ?? name}" instruction set`,
            `Following the "${skill ?? name}" instruction set`,
            `About to follow the "${skill ?? name}" instruction set`,
          ),
          kind: "other",
          status,
          technical: name,
        };
      }
      return {
        headline: tense(
          status,
          `Used the ${humanizeFileName(name)} tool`,
          `Using the ${humanizeFileName(name)} tool`,
          `About to use the ${humanizeFileName(name)} tool`,
        ),
        detail: item.title ?? undefined,
        kind: "other",
        status,
        technical: name,
      };
    }
    case "notification": {
      return {
        headline: "An update arrived",
        detail: item.title ?? undefined,
        kind: "message",
        status: base("done"),
        technical: item.type,
      };
    }
    default: {
      const unknown = item as {
        readonly type: string;
        readonly title: string | null;
        readonly status: OrchestrationV2TurnItemStatus;
      };
      return {
        headline: unknown.title ?? "Did something",
        kind: "other",
        status: narrationStatus(unknown.status),
        technical: unknown.type,
      };
    }
  }
}

export interface RunChecklist {
  readonly done: ReadonlyArray<string>;
  readonly now: ReadonlyArray<string>;
  readonly next: ReadonlyArray<string>;
}

export interface RunSummary {
  readonly summary: string;
  readonly checklist: RunChecklist;
  readonly needsYou: boolean;
}

/** What makes two steps "the same step" for retry purposes: the same intent, the same file. */
function retryKey(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "command_execution":
      return `command:${classifyCommand(item.input).infinitive}`;
    case "file_change":
      return `file:${item.fileName}`;
    default:
      return null;
  }
}

/**
 * Failed steps that a later step of the same run redid successfully (a sandboxed push that
 * was retried outside it, a check run again after a fix). They "needed a second try"; the
 * run did not end with them broken. Pass one run's items, in stream order.
 */
export function retriedFailures(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  ctx: NarrationContext = {},
): ReadonlySet<string> {
  const retried = new Set<string>();
  const failedByKey = new Map<string, Array<string>>();
  for (const item of items) {
    const key = retryKey(item);
    if (key === null) continue;
    const status = describeTurnItem(item, ctx).status;
    if (status === "failed") {
      failedByKey.set(key, [...(failedByKey.get(key) ?? []), item.id]);
    } else if (status === "done") {
      for (const id of failedByKey.get(key) ?? []) retried.add(id);
      failedByKey.delete(key);
    }
  }
  return retried;
}

const TOOLISH: ReadonlySet<NarrationKind> = new Set([
  "edit",
  "read",
  "command",
  "search",
  "web",
  "subagent",
  "test",
  "install",
  "git",
]);

function countNoun(kind: NarrationKind, count: number): string {
  switch (kind) {
    case "edit":
      return `edited ${pluralize(count, "file")}`;
    case "read":
      return `read ${pluralize(count, "file")}`;
    case "command":
      return `ran ${pluralize(count, "command")}`;
    case "search":
      return `searched the project ${pluralize(count, "time")}`;
    case "web":
      return `looked ${count === 1 ? "something" : `${count} things`} up on the web`;
    case "subagent":
      return `handed off ${pluralize(count, "side task")}`;
    case "test":
      return `ran ${pluralize(count, "check")}`;
    case "install":
      return `installed add-ons ${pluralize(count, "time")}`;
    case "git":
      return `worked with the project history ${pluralize(count, "time")}`;
    default:
      return `did ${pluralize(count, "other thing")}`;
  }
}

function latestTodoList(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<OrchestrationV2PlanStep> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.type === "todo_list" && item.steps.length > 0) return item.steps;
  }
  return undefined;
}

export function summarizeRun(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  ctx: NarrationContext = {},
): RunSummary {
  const narrated = items.map((item) => ({ item, narration: describeTurnItem(item, ctx) }));
  const tools = narrated.filter((n) => TOOLISH.has(n.narration.kind));
  const needsYou = narrated.some(
    (n) =>
      ((n.item.type === "approval_request" || n.item.type === "user_input_request") &&
        n.narration.status === "pending") ||
      (n.item.type === "secret_request" && n.narration.status === "pending") ||
      (n.item.type === "proposed_plan" && n.narration.status === "done"),
  );

  const doneCounts = new Map<NarrationKind, number>();
  for (const { narration } of tools) {
    if (narration.status !== "done") continue;
    doneCounts.set(narration.kind, (doneCounts.get(narration.kind) ?? 0) + 1);
  }
  const failed = tools.filter((n) => n.narration.status === "failed");
  const running = tools.filter((n) => n.narration.status === "running");

  const steps = latestTodoList(items);
  const checklist: RunChecklist = steps
    ? {
        done: steps.filter((s) => s.status === "completed").map((s) => s.text),
        now: steps.filter((s) => s.status === "running").map((s) => s.text),
        next: steps.filter((s) => s.status === "pending").map((s) => s.text),
      }
    : {
        done: dedupe(
          tools.filter((n) => n.narration.status === "done").map((n) => n.narration.headline),
        ).slice(-6),
        now: dedupe(running.map((n) => n.narration.headline)),
        next: dedupe(
          tools.filter((n) => n.narration.status === "pending").map((n) => n.narration.headline),
        ),
      };

  const parts = [...doneCounts.entries()].map(([kind, count]) => countNoun(kind, count));
  const first =
    parts.length === 0
      ? tools.length === 0
        ? needsYou
          ? "The assistant is waiting on you."
          : items.length === 0
            ? progress.nothingYet
            : "The assistant has only talked so far — no files touched."
        : "Nothing has finished yet."
      : `So far the assistant has ${joinList(parts)}.`;
  const second = needsYou
    ? " It needs something from you before it can carry on."
    : running.length > 0
      ? ` Right now: ${lowerFirst(running.at(-1)!.narration.headline)}.`
      : failed.length > 0
        ? ` ${pluralize(failed.length, "step")} didn't work — details below.`
        : "";
  return { summary: `${first}${second}`.trim(), checklist, needsYou };
}

function dedupe(values: ReadonlyArray<string>): Array<string> {
  return [...new Set(values)];
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

export function progressHint(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runState: OrchestrationV2RunStatus | null | undefined,
  ctx: NarrationContext = {},
): string {
  switch (runState) {
    case "preparing":
    case "queued":
    case "starting":
      return progress.gettingReady;
    case "waiting": {
      const pendingApproval = items.some(
        (i) =>
          i.type === "approval_request" &&
          narrationStatus(i.status) !== "done" &&
          narrationStatus(i.status) !== "denied",
      );
      return pendingApproval ? progress.waitingForApproval : progress.waitingForYou;
    }
    case "completed": {
      const { summary } = summarizeRun(items, ctx);
      return `${progress.allDone} ${summary}`.trim();
    }
    case "failed":
      return progress.somethingWentWrong;
    case "interrupted":
    case "cancelled":
      return progress.stopped;
    case "rolled_back":
      return progress.restored;
    case "running":
    default: {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const narration = describeTurnItem(items[i]!, ctx);
        if (narration.status === "running" && TOOLISH.has(narration.kind))
          return `${narration.headline}…`;
        if (narration.status === "running" && narration.kind === "reasoning")
          return `${narration.headline}…`;
      }
      return runState === undefined || runState === null ? progress.nothingYet : progress.working;
    }
  }
}
