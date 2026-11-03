// The live preview, pure part: how a project's site is started, whether starting it needs the
// person's (or a grown-up's) yes, and what the plain client is told. Starting the site runs the
// project's own start script on this Mac, so it is judged like any command the assistant asks
// to run: the same hard rules, the same Family rules, the same "Ask me first".
import type { RuntimeMode } from "@t3tools/contracts";
import { evaluateFamilyRequest, describeFamilyMatches } from "@t3tools/skycot-rules/family";
import { plainTerminalText } from "@t3tools/skycot-rules/preview";
import { describeMatches, evaluateRequest, type RuleContext } from "@t3tools/skycot-rules/rules";

/** The files that say how a project starts, read from its folder (null when missing). */
export interface ProjectStartFiles {
  readonly packageJson: string | null;
  /** T3's project file; a script with `previewUrl` is T3's own "this starts the preview". */
  readonly t3Json: string | null;
  readonly lockfiles: ReadonlyArray<string>;
  /**
   * The folders (inside the project, "" for the folder itself) that hold an index.html, best
   * first. With no start script, the first is shown as a plain web page.
   */
  readonly pageFolders?: ReadonlyArray<string>;
}

export interface PreviewCommand {
  /** What runs in the project folder: `npm run dev`. */
  readonly runner: string;
  /** What that runs in turn (the script's own text), judged by the rules too. */
  readonly script: string;
  /** `static`: no start script, so SKYCOT shows the project's index.html itself. */
  readonly source: "package.json" | "t3.json" | "static";
  /** The address the project file names, when it names one. */
  readonly previewUrl: string | null;
  /** For `static`: the folder shown, inside the project ("" for the folder itself). */
  readonly pageFolder?: string;
}

/** What a plain web page's "command" reads as, in Advanced mode and in a message to the assistant. */
export const STATIC_RUNNER = "SKYCOT's built-in page server";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Start scripts, best first: the usual names a site's own "run me" goes by. */
export const START_SCRIPT_NAMES = ["dev", "start", "serve", "preview"] as const;

function packageRunner(lockfiles: ReadonlyArray<string>): string {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("bun.lock") || lockfiles.includes("bun.lockb")) return "bun";
  return "npm";
}

/** How this project's site starts, or null when it has nothing to start. */
export function findPreviewCommand(files: ProjectStartFiles): PreviewCommand | null {
  const t3Scripts = record(parseJson(files.t3Json))["scripts"];
  if (Array.isArray(t3Scripts)) {
    for (const entry of t3Scripts) {
      const script = record(entry);
      const command = typeof script["command"] === "string" ? script["command"].trim() : "";
      const previewUrl =
        typeof script["previewUrl"] === "string" ? script["previewUrl"].trim() : "";
      if (command.length > 0 && previewUrl.length > 0) {
        return { runner: command, script: command, source: "t3.json", previewUrl };
      }
    }
  }
  const scripts = record(record(parseJson(files.packageJson))["scripts"]);
  for (const name of START_SCRIPT_NAMES) {
    const body = scripts[name];
    if (typeof body === "string" && body.trim().length > 0) {
      return {
        runner: `${packageRunner(files.lockfiles)} run ${name}`,
        script: body.trim(),
        source: "package.json",
        previewUrl: null,
      };
    }
  }
  // A plain web page (index.html, no server of its own): SKYCOT shows the folder itself.
  const pageFolder = files.pageFolders?.[0];
  if (pageFolder !== undefined) {
    return {
      runner: STATIC_RUNNER,
      script: pageFolder.length > 0 ? `${pageFolder}/index.html` : "index.html",
      source: "static",
      previewUrl: null,
      pageFolder,
    };
  }
  return null;
}

/** Why a grown-up is asked when the preview can't run inside the Family sandbox here. */
export const FAMILY_UNCONTAINED_REASON =
  "runs the project's own code, and this computer can't keep it inside the project";

export type StartDecision =
  /** Starts without a question ("Just do it, carefully" with nothing risky, or hands-off). */
  | { readonly kind: "start" }
  /** The person's yes, like any command in "Ask me first". */
  | { readonly kind: "ask"; readonly reasons: ReadonlyArray<string> }
  /** The Family profile: only the parent code may allow it. */
  | { readonly kind: "grown-up"; readonly reasons: ReadonlyArray<string> };

/**
 * Whether starting the site needs a yes, and whose. Both the runner and the script it runs are
 * judged, so `"dev": "npx serve"` is caught as the install it is. With the Family profile on,
 * the child's own yes is enough only when SKYCOT can start the site inside the Family sandbox
 * (`familyContained`, familyContainment.ts): the words of the command can't show what the files
 * it runs will do.
 */
export function startDecision(input: {
  readonly command: PreviewCommand;
  readonly runtimeMode: RuntimeMode;
  readonly familyOn: boolean;
  readonly familyContained?: boolean;
  readonly ctx: RuleContext;
}): StartDecision {
  // Showing a plain page runs nothing on this Mac (no command, no install): SKYCOT reads the
  // project's own files on 127.0.0.1, so there is nothing to say yes to, in any mode.
  if (input.command.source === "static") return { kind: "start" };
  const texts = [...new Set([input.command.runner, input.command.script])];
  if (input.familyOn) {
    const evaluations = texts.map((command) =>
      evaluateFamilyRequest({ kind: "command", command }, input.ctx),
    );
    const reasons = unique(
      evaluations.flatMap((evaluation) => [
        describeMatches(evaluation.base.matches),
        describeFamilyMatches(evaluation.family),
      ]),
    );
    if (input.familyContained !== true) {
      return { kind: "grown-up", reasons: unique([...reasons, FAMILY_UNCONTAINED_REASON]) };
    }
    return evaluations.some((evaluation) => evaluation.needsGrownUp)
      ? { kind: "grown-up", reasons }
      : { kind: "ask", reasons };
  }
  const evaluations = texts.map((command) =>
    evaluateRequest({ kind: "command", command }, input.ctx),
  );
  const reasons = unique(evaluations.map((evaluation) => describeMatches(evaluation.matches)));
  // Hands-off checks nothing, here as everywhere else.
  if (input.runtimeMode === "full-access") return { kind: "start" };
  if (evaluations.some((evaluation) => evaluation.decision === "hold")) {
    return { kind: "ask", reasons };
  }
  return input.runtimeMode === "approval-required" ? { kind: "ask", reasons } : { kind: "start" };
}

function unique(parts: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(parts.filter((part) => part.length > 0))];
}

/**
 * Whether the plain client may draw the page inside its own window. A page that forbids being
 * framed would show a browser error there; the client offers "Open in browser" instead.
 */
export function frameableFromHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  const frameOptions = headers["x-frame-options"]?.trim().toLowerCase();
  if (frameOptions === "deny" || frameOptions === "sameorigin") return false;
  const policy = headers["content-security-policy"];
  if (policy === undefined) return true;
  const ancestors = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("frame-ancestors"));
  if (ancestors === undefined) return true;
  return ancestors.split(/\s+/).slice(1).includes("*");
}

const TAIL_LINES = 12;
const LINE_MAX = 200;

/**
 * Lines that say nothing to a person or the assistant: Node's own stack frames, a shell's
 * end-of-line marks and prompts, and the echo of the command SKYCOT typed.
 */
const NOISE = [
  /\(node:internal\//,
  /^\s*at (?:async )?node:internal\//,
  /^\s*[\\%$#>❯➜]\s*$/,
  /;\s*exit\s*$/,
];

/**
 * The last lines a failed start printed, as plain text, for the error card and the message to
 * the assistant. The home folder is shortened to "~" so a grown-up's account name stays home.
 */
export function outputTail(output: string, homeDir: string | null): string {
  const lines = plainTerminalText(output)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !NOISE.some((pattern) => pattern.test(line)))
    .slice(-TAIL_LINES)
    .map((line) => (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line));
  const text = lines.join("\n");
  return homeDir && homeDir.length > 1 ? text.split(homeDir).join("~") : text;
}

/** What the plain client is told about one conversation's preview. */
export type PreviewStatus =
  /** The conversation or its folder is gone. */
  | { readonly state: "no-folder" }
  /** The project has no start script and no index.html yet. */
  | { readonly state: "no-site" }
  | {
      readonly state: "ready";
      readonly command: PreviewCommand;
      readonly decision: StartDecision;
      /** Names this exact start for a grown-up's one-off yes (`approve`). */
      readonly requestId: string;
    }
  | { readonly state: "starting"; readonly command: PreviewCommand; readonly startedAt: number }
  | {
      readonly state: "running";
      readonly command: PreviewCommand;
      readonly url: string;
      readonly frameable: boolean;
      /** Changes when files the static page server can show change. */
      readonly version?: string;
      /**
       * Family profile: pages of this site that tried internet sites no grown-up has allowed
       * yet (@t3tools/skycot-rules/page-internet). `page` is the page's real path on this Mac.
       */
      readonly internetAsks?: ReadonlyArray<{
        readonly page: string;
        readonly sites: ReadonlyArray<string>;
      }>;
    }
  | {
      readonly state: "failed";
      readonly command: PreviewCommand;
      readonly reason: "exited" | "no-address";
      readonly output: string;
    }
  /**
   * It was showing the site, then the site's program ended (it crashed, something stopped it,
   * or its terminal was closed in Advanced mode). Not a start that failed: "Start it again".
   */
  | { readonly state: "stopped"; readonly command: PreviewCommand; readonly output: string };

/** How long a start may take to answer on an address before it counts as failed. */
export const START_TIMEOUT_MS = 90_000;
/** A preview nobody has looked at for this long is stopped. */
export const IDLE_STOP_MS = 15 * 60_000;
/** How often the engine looks for idle previews. */
export const IDLE_CHECK_MS = 60_000;
/**
 * A gap this long between two idle checks means the Mac was asleep (timers stop, the wall clock
 * does not): that time is not "nobody looked", so the previews are not stopped for it.
 */
export const ASLEEP_GAP_MS = 3 * IDLE_CHECK_MS;

/**
 * One idle check for one preview: stop it, keep it, or (the first check after the Mac slept)
 * count it as just seen. Wall-clock times in milliseconds; `lastCheck` is null on the first check.
 */
export function idleVerdict(input: {
  readonly now: number;
  readonly lastCheck: number | null;
  readonly lastSeen: number;
}): "stop" | "keep" | "woke" {
  if (input.lastCheck !== null && input.now - input.lastCheck > ASLEEP_GAP_MS) return "woke";
  return input.now - input.lastSeen > IDLE_STOP_MS ? "stop" : "keep";
}
