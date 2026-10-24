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
import {
  addOnAskOf,
  isTrustedAddOnAsk,
  parseApprovedDownload,
  parseApprovedInstall,
  type ApprovedDownload,
  type ApprovedInstall,
} from "@t3tools/skycot-rules/addons";
import { readPolicyDecision } from "@t3tools/skycot-rules/decision";
import { workRootsFor } from "@t3tools/skycot-rules/questions";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as RuntimeRequestService from "../orchestration-v2/RuntimeRequestService.ts";
import * as ProcessRunner from "../processRunner.ts";
import { keepAddOnsOutOfVersions, type RunGit } from "./questions/SkycotKeepOutOfVersions.ts";
import * as SkycotQuestions from "./questions/SkycotQuestions.ts";
import { makeAddOnStore } from "./SkycotAddOnApprovals.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import { addOnFilePathOption } from "./SkycotFamilyExtras.ts";
import { requestFacts } from "./SkycotPolicy.ts";

// The parsers are the shared rules' (packages/skycot-rules/src/addons.ts), so the cards and the
// Family rules read an add-on ask exactly as this installer does.
export {
  parseApprovedDownload,
  parseApprovedInstall,
  type ApprovedDownload,
  type ApprovedInstall,
  type InstallManager,
} from "@t3tools/skycot-rules/addons";

const INSTALL_TIMEOUT = "3 minutes";
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = "60 seconds";

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

const GROWN_UP_SAID_YES = "a grown-up said yes";

/** Why SKYCOT did it, for the assistant's note: the policy's relief, else a person's yes. */
export function becauseFor(relief: string | undefined): string {
  switch (relief) {
    case "trusted-add-on":
      return "this is a trusted add-on";
    case "approved-before":
      return "a grown-up already said yes to it in this conversation";
    default:
      return "someone said yes";
  }
}

/** What the assistant is told, in place of its own command's result. */
export function noteForAssistant(
  install: ApprovedInstall,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
  because: string = GROWN_UP_SAID_YES,
): string {
  const names = install.packages.join(", ");
  return outcome.ok
    ? `SKYCOT note: ${because}, so SKYCOT installed ${names} into this project for you ` +
        `(${install.manager}, with install scripts off). Your own install command was skipped on ` +
        `purpose and shows as declined: do not run it again. Carry on with the plan.`
    : `SKYCOT note: ${because}, but SKYCOT could not install ${names}: ${outcome.reason} ` +
        `Your own install command was skipped. Carry on another way, without it.`;
}

/** What the assistant is told after SKYCOT's own download. */
export function noteForDownload(
  download: ApprovedDownload,
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
  because: string = GROWN_UP_SAID_YES,
): string {
  return outcome.ok
    ? `SKYCOT note: ${because}, so SKYCOT downloaded ${download.url} into ` +
        `${download.output} in this project for you. Your own download command was skipped on ` +
        `purpose and shows as declined: do not run it again. Carry on with the plan.`
    : `SKYCOT note: ${because}, but SKYCOT could not download ${download.url}: ` +
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
    const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
    const addOnFile = yield* addOnFilePathOption;
    const addOns = addOnFile === null ? null : yield* makeAddOnStore(addOnFile);

    /**
     * Family only: remember a person's yes for this conversation ("one yes covers repeats"), or
     * note what SKYCOT added by itself for the grown-ups' recap. A yes the child could give
     * (a trusted add-on while the parent's switch is on) is never remembered as a grown-up's.
     */
    const remember = Effect.fnUntraced(function* (
      threadId: ThreadId,
      plan: { readonly names: ReadonlyArray<string>; readonly trusted: boolean },
      relief: string | undefined,
      ok: boolean,
    ) {
      if (addOns === null || Option.isNone(family) || plan.names.length === 0) return;
      if (!(yield* family.value.isEnabled)) return;
      if (relief === "trusted-add-on" || relief === "approved-before") {
        if (ok) {
          yield* addOns.recordAdded({
            threadId,
            names: plan.names,
            how: relief === "trusted-add-on" ? "trusted" : "again",
          });
        }
        return;
      }
      if (relief !== undefined) return;
      const childCouldSayYes =
        plan.trusted &&
        (yield* family.value.trustedAddOnsOn.pipe(Effect.catchCause(() => Effect.succeed(true))));
      if (!childCouldSayYes) yield* addOns.approve(threadId, plan.names);
    });

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
      const names = addOnAskOf(command)?.names ?? [];
      const trusted = isTrustedAddOnAsk(addOnAskOf(command));
      return install !== null
        ? ({ kind: "install", install, folder: projectRoot, names, trusted } as const)
        : ({ kind: "download", download: download!, folder: projectRoot, names, trusted } as const);
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
        const decided = readPolicyDecision(input.answers);
        // A policy yes without a relief never reaches here for an add-on (it always needs one).
        const because = decided === null ? GROWN_UP_SAID_YES : becauseFor(decided.relief);
        const relief = decided === null ? undefined : (decided.relief ?? "policy");

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
          yield* remember(input.threadId, plan, relief, fetched.ok).pipe(
            Effect.catchCause((cause) => Effect.logWarning("skycot-installs.not-noted", { cause })),
          );
          yield* tellAssistant(input, noteForDownload(plan.download, fetched, because)).pipe(
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
        yield* remember(input.threadId, plan, relief, outcome.ok).pipe(
          Effect.catchCause((cause) => Effect.logWarning("skycot-installs.not-noted", { cause })),
        );
        yield* tellAssistant(input, noteForAssistant(plan.install, outcome, because)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("skycot-installs.note-not-delivered", { cause }),
          ),
        );
        return yield* base.respond({ ...input, decision: "decline" });
      }),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
