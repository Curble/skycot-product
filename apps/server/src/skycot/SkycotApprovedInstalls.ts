// An add-on install someone said yes to, done by SKYCOT itself.
//
// First principles: a yes to "install 1 add-on: the three add-on" has to end with that add-on
// installed, and with nothing more than that. Codex runs every command SKYCOT governs in its
// workspace sandbox with the internet off (SkycotPolicy: "untrusted" in a workspace-write
// sandbox), and an approved command still runs inside it, so `npm install three` can never
// download anything: the yes would mean nothing (live test, 24 October 2026). Opening the
// sandbox's internet instead would lift the backstop for every step a child allows, not only
// the one a grown-up said yes to.
//
// So the yes is kept here, at the one place every answer passes on its way to the assistant
// (the phone, the Watch, the Mac's parent code and the person's own card all end in
// RuntimeRequestService.respond). When the answer is a plain yes to a command that only
// installs named add-ons into the conversation's own folder, SKYCOT runs that install itself,
// outside the sandbox, with the add-ons' own install scripts off; tells the assistant what
// happened; and answers its command "decline", so the sandboxed copy never runs. Anything else
// (another command, flags it does not know, a folder elsewhere, yarn) goes through unchanged.
//
// The same goes for a plain download of one file from an https address into the folder
// (`curl -L -o three.module.js https://…`, `wget -O … https://…`): the AI often fetches an
// add-on that way instead (video shoot, 24 October 2026), and the sandbox would fail it in the
// same way. SKYCOT downloads that one file itself, inside the folder, with a size limit.
//
// Codex only: Claude Code runs an approved command without a sandbox, so its yes already works.

import {
  MessageId,
  type ProviderDriverKind,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { workRootsFor } from "@t3tools/skycot-rules/questions";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as RuntimeRequestService from "../orchestration-v2/RuntimeRequestService.ts";
import * as ProcessRunner from "../processRunner.ts";
import { keepAddOnsOutOfVersions, type RunGit } from "./questions/SkycotKeepOutOfVersions.ts";
import * as SkycotQuestions from "./questions/SkycotQuestions.ts";
import { requestFacts } from "./SkycotPolicy.ts";

export type InstallManager = "npm" | "pnpm" | "bun";

export interface ApprovedInstall {
  readonly manager: InstallManager;
  readonly packages: ReadonlyArray<string>;
  readonly dev: boolean;
}

const MAX_PACKAGES = 10;
const INSTALL_TIMEOUT = "3 minutes";

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
const HARMLESS_FLAGS = new Set(["-S", "--save", "--save-prod", "-P"]);

/** `/bin/zsh -lc 'npm install three'` as Codex reports it, or the bare command. */
function unwrapShell(command: string): string {
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
  const packages: Array<string> = [];
  for (const word of rest) {
    if (DEV_FLAGS.has(word)) dev = true;
    else if (HARMLESS_FLAGS.has(word)) continue;
    else if (PACKAGE_SPEC.test(word)) packages.push(word);
    else return null;
  }
  if (packages.length === 0 || packages.length > MAX_PACKAGES) return null;
  return { manager: program as InstallManager, packages, dev };
}

export interface ApprovedDownload {
  /** The https address, exactly as asked. */
  readonly url: string;
  /** Where it goes, relative to the conversation's folder. */
  readonly output: string;
  /** Folders a leading `mkdir -p …` asked for, made inside the conversation's folder too. */
  readonly folders?: ReadonlyArray<string>;
}

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = "60 seconds";
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
    output = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  }
  const safe = output === null ? null : safeOutputPath(output);
  if (safe === null) return null;
  return folders.length === 0 ? { url, output: safe } : { url, output: safe, folders };
}

/** The install SKYCOT runs: the same add-ons, with their install scripts off. */
export function installArguments(install: ApprovedInstall): ReadonlyArray<string> {
  switch (install.manager) {
    case "npm":
      return [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(install.dev ? ["--save-dev"] : []),
        ...install.packages,
      ];
    case "pnpm":
      return [
        "add",
        "--ignore-scripts",
        ...(install.dev ? ["--save-dev"] : []),
        ...install.packages,
      ];
    case "bun":
      return ["add", "--ignore-scripts", ...(install.dev ? ["--dev"] : []), ...install.packages];
  }
}

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

/** What the assistant is told, in place of its own command's result. */
export function noteForAssistant(
  install: ApprovedInstall,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): string {
  const names = install.packages.join(", ");
  return outcome.ok
    ? `SKYCOT note: a grown-up said yes, so SKYCOT installed ${names} into this project for you ` +
        `(${install.manager}, with install scripts off). Your own install command was skipped on ` +
        `purpose and shows as declined: do not run it again. Carry on with the plan.`
    : `SKYCOT note: a grown-up said yes, but SKYCOT could not install ${names}: ${outcome.reason} ` +
        `Your own install command was skipped. Carry on another way, without it.`;
}

/** What the assistant is told after SKYCOT's own download. */
export function noteForDownload(
  download: ApprovedDownload,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): string {
  return outcome.ok
    ? `SKYCOT note: a grown-up said yes, so SKYCOT downloaded ${download.url} into ` +
        `${download.output} in this project for you. Your own download command was skipped on ` +
        `purpose and shows as declined: do not run it again. Carry on with the plan.`
    : `SKYCOT note: a grown-up said yes, but SKYCOT could not download ${download.url}: ` +
        `${outcome.reason} Your own download command was skipped. Carry on another way, without it.`;
}

type DownloadOutcome =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly reason: string };

/** Fetch one https file into the folder, with a size limit; never outside the folder. */
const downloadInto = Effect.fn("SkycotApprovedInstalls.download")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  folder: string,
  download: ApprovedDownload,
) {
  const client = yield* HttpClient.HttpClient;
  const target = path.resolve(folder, download.output);
  const relative = path.relative(folder, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "it would have gone outside this project." } as DownloadOutcome;
  }
  const response = yield* client.get(download.url);
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: `the website answered ${response.status}.` } as DownloadOutcome;
  }
  const declared = Number(response.headers["content-length"] ?? "0");
  if (declared > MAX_DOWNLOAD_BYTES) {
    return { ok: false, reason: "the file is too big." } as DownloadOutcome;
  }
  const body = new Uint8Array(yield* response.arrayBuffer);
  if (body.byteLength > MAX_DOWNLOAD_BYTES) {
    return { ok: false, reason: "the file is too big." } as DownloadOutcome;
  }
  for (const name of download.folders ?? []) {
    const made = path.resolve(folder, name);
    const inside = path.relative(folder, made);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      return {
        ok: false,
        reason: "a folder would have gone outside this project.",
      } as DownloadOutcome;
    }
    yield* fs.makeDirectory(made, { recursive: true });
  }
  yield* fs.makeDirectory(path.dirname(target), { recursive: true });
  yield* fs.writeFile(target, body);
  return { ok: true, bytes: body.byteLength } as DownloadOutcome;
});

function failureReason(output: ProcessRunner.ProcessRunOutput): string {
  if (output.timedOut) return "it took too long.";
  const text = `${output.stderr}\n${output.stdout}`;
  const line = text
    .split(/\r?\n/u)
    .map((part) => part.replace(/^npm (?:error|ERR!)\s*/u, "").trim())
    .find((part) => part.length > 0 && !/^(?:A complete log|Log files)/u.test(part));
  return line === undefined ? "the install failed." : `${line.slice(0, 200)}.`;
}

/** `git <args>` in `cwd` through the process runner, for keepAddOnsOutOfVersions. */
export const gitThroughRunner =
  (runner: ProcessRunner.ProcessRunner["Service"], cwd: string): RunGit =>
  (args) =>
    runner
      .run({ command: "git", args, cwd, timeout: "10 seconds", timeoutBehavior: "timedOutResult" })
      .pipe(Effect.map((output) => ({ exitCode: output.code, stdout: output.stdout })));

/**
 * RuntimeRequestService, with approved add-on installs done by SKYCOT. Wraps the service the
 * engine already has; only built while the SKYCOT policy is on (runtimeLayer).
 */
export const layerRuntimeRequests = Layer.effect(
  RuntimeRequestService.RuntimeRequestServiceV2,
  Effect.gen(function* () {
    const base = yield* RuntimeRequestService.RuntimeRequestServiceV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
    const runner = yield* ProcessRunner.ProcessRunner;
    const questionsRoot = yield* SkycotQuestions.questionsRootOption;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    /** The install a yes stands for, and where it goes; null when this yes is not one. */
    const planFor = Effect.fnUntraced(function* (threadId: ThreadId, requestId: RuntimeRequestId) {
      const approval = yield* projections.getTurnItem({
        threadId,
        itemId: IdAllocator.derive.approvalTurnItem({ requestId }),
      });
      if (approval === null || approval.type !== "approval_request") return null;
      if (approval.requestKind !== "command") return null;
      const driver: ProviderDriverKind | undefined = approval.nativeItemRef?.driver;
      if (driver !== "codex") return null;
      const ref = approval.nativeItemRef;
      const toolCall =
        ref === null || ref.nativeId === null
          ? null
          : yield* projections.getTurnItem({
              threadId,
              itemId: IdAllocator.derive.turnItemFromProviderItem({
                driver,
                nativeItemId: ref.nativeId,
              }),
            });
      const facts = requestFacts(approval, toolCall, driver);
      const command = facts?.kind === "command" ? facts.command : undefined;
      const install = parseApprovedInstall(command);
      const download = install === null ? parseApprovedDownload(command) : null;
      if (install === null && download === null) return null;
      const thread = yield* projections.getThread(threadId);
      const project = yield* projects.get(thread.projectId);
      const { projectRoot } = workRootsFor({
        projectFolder: Option.isSome(project) ? project.value.workspaceRoot : null,
        worktreePath: thread.worktreePath,
        questionsRoot,
      });
      if (projectRoot === null) return null;
      return install !== null
        ? ({ kind: "install", install, folder: projectRoot } as const)
        : ({ kind: "download", download: download!, folder: projectRoot } as const);
    });

    const tellAssistant = Effect.fnUntraced(function* (
      input: Parameters<RuntimeRequestService.RuntimeRequestServiceV2Shape["respond"]>[0],
      text: string,
    ) {
      const session = yield* sessions.get(input.providerSessionId);
      if (Option.isNone(session)) return;
      const running = yield* projections.getRunningTurnContext(input.threadId);
      if (
        running.run === undefined ||
        running.providerThread === undefined ||
        running.providerTurn === undefined
      )
        return;
      yield* session.value.steerTurn({
        threadId: input.threadId,
        runId: running.run.id,
        providerThread: running.providerThread,
        providerTurnId: running.providerTurn.id,
        message: {
          messageId: MessageId.make(`skycot-install:${input.requestId}`),
          text,
          attachments: [],
          createdBy: "system",
          creationSource: "server",
        },
      });
    });

    return RuntimeRequestService.RuntimeRequestServiceV2.of({
      respond: Effect.fn("SkycotApprovedInstalls.respond")(function* (input) {
        if (input.decision !== "accept") return yield* base.respond(input);
        const plan = yield* planFor(input.threadId, input.requestId).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (plan === null) return yield* base.respond(input);

        if (plan.kind === "download") {
          const fetched = yield* downloadInto(fs, path, plan.folder, plan.download).pipe(
            Effect.provide(FetchHttpClient.layer),
            Effect.timeout(DOWNLOAD_TIMEOUT),
            Effect.catch(() =>
              Effect.succeed({ ok: false, reason: "the download didn't work." } as DownloadOutcome),
            ),
          );
          yield* Effect.logInfo("skycot-installs.downloaded-for-assistant", {
            host: new URL(plan.download.url).host,
            file: plan.download.output,
            ok: fetched.ok,
            ...(fetched.ok ? { bytes: fetched.bytes } : {}),
          });
          yield* tellAssistant(input, noteForDownload(plan.download, fetched)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("skycot-installs.note-not-delivered", { cause }),
            ),
          );
          return yield* base.respond({ ...input, decision: "decline" });
        }

        // The add-ons are not something the child made: keep them out of "What changed" and
        // the versions, for a folder that started keeping versions before SKYCOT did this.
        yield* keepAddOnsOutOfVersions(gitThroughRunner(runner, plan.folder), plan.folder, {
          unlessIgnored: true,
        });

        const command = [plan.install.manager, ...installArguments(plan.install)]
          .map(quote)
          .join(" ");
        // A login shell, as the assistant's own commands get, so the person's PATH finds npm.
        const outcome = yield* runner
          .run({
            command: "/bin/zsh",
            args: ["-lc", command],
            cwd: plan.folder,
            timeout: INSTALL_TIMEOUT,
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: 256 * 1024,
            outputMode: "truncate",
          })
          .pipe(
            Effect.map((output) =>
              output.code === 0 && !output.timedOut
                ? ({ ok: true } as const)
                : ({ ok: false, reason: failureReason(output) } as const),
            ),
            Effect.orElseSucceed(
              () => ({ ok: false, reason: "the install would not start." }) as const,
            ),
          );
        yield* Effect.logInfo("skycot-installs.installed-for-assistant", {
          manager: plan.install.manager,
          packages: plan.install.packages,
          ok: outcome.ok,
        });
        // The note first, so it is waiting when the assistant reads its declined command.
        yield* tellAssistant(input, noteForAssistant(plan.install, outcome)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("skycot-installs.note-not-delivered", { cause }),
          ),
        );
        return yield* base.respond({ ...input, decision: "decline" });
      }),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
