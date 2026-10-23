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
// Codex only: Claude Code runs an approved command without a sandbox, so its yes already works.

import {
  MessageId,
  type ProviderDriverKind,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
      const install = parseApprovedInstall(facts?.kind === "command" ? facts.command : undefined);
      if (install === null) return null;
      const thread = yield* projections.getThread(threadId);
      const project = yield* projects.get(thread.projectId);
      const { projectRoot } = workRootsFor({
        projectFolder: Option.isSome(project) ? project.value.workspaceRoot : null,
        worktreePath: thread.worktreePath,
        questionsRoot,
      });
      return projectRoot === null ? null : { install, folder: projectRoot };
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
      respond: (input) =>
        Effect.gen(function* () {
          if (input.decision !== "accept") return yield* base.respond(input);
          const plan = yield* planFor(input.threadId, input.requestId).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (plan === null) return yield* base.respond(input);

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
