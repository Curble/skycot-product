// nondev-seam: beta6-install-exact
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
// Codex, and Claude while the Family profile is on: a child's Claude runs every command in
// Claude Code's sandbox with the internet off (SkycotFamilyClaude.familySandbox), so it has the
// same problem. Claude is told through its declined command's message instead of a steer, so
// the note and the "declined" arrive as one answer. A grown-up's own Claude runs an approved
// command without a sandbox, so its yes already works.
//
// Nothing in the project steers what SKYCOT runs (pre-open-source review F1-R2, 3 Nov 2026).
// The install and the download run outside every sandbox, in a folder the child's assistant can
// write, so a file it wrote there must not change what they do:
//   - the package manager gets no settings but SKYCOT's: an empty user and global config, no
//     inherited npm_config_* / NODE_OPTIONS / COREPACK_* steering, corepack ignores the project's
//     "packageManager", the folder is fixed (no walking up to a parent's package.json or
//     workspace), pnpm skips `.pnpmfile.cjs` (which it otherwise runs as code even with scripts
//     off) and bun reads no `bunfig.toml`. A project `.npmrc` (read by npm, pnpm and bun, and able
//     to name a program npm runs) or `pnpm-workspace.yaml` can't be switched off, so the install
//     is refused with a sentence saying why (`installRefusal`);
//   - install scripts never run (`--ignore-scripts`), for the add-ons and for the project's own
//     package.json: a card says "install 1 add-on", never "run its setup", and a yes is only to
//     what the card said. An add-on that needs its script (rare for the web add-ons children
//     use) is left half-installed and the assistant is told to carry on another way;
//   - `node_modules`, package.json and the lockfiles must be real files and folders, and no
//     add-on folder in `node_modules` may be a link that leads outside the project, so the
//     install's writes stay inside;
//   - a download goes through no link: every folder on the way is checked, the file is written
//     next to its place under a fresh name with O_NOFOLLOW and moved over it (so a link or a
//     hard link there is replaced, never written through), and its folder's real place is
//     checked again before the move (`writeDownloadInside`).

// @effect-diagnostics-next-line nodeBuiltinImport:off -- a fresh name for the downloaded file's first copy.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- lstat/O_NOFOLLOW checks that the Effect FileSystem doesn't offer.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- path arithmetic for the same checks.
import * as NodePath from "node:path";

import {
  MessageId,
  type ProviderDriverKind,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
import * as SkycotFamilyClaude from "./SkycotFamilyClaude.ts";
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

/**
 * The install SKYCOT runs: the same add-ons, with their install scripts off, in `folder` and
 * nowhere above it, with no project hook file.
 */
export function installArguments(install: ApprovedInstall, folder: string): ReadonlyArray<string> {
  switch (install.manager) {
    case "npm":
      return [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        folder,
        ...(install.dev ? ["--save-dev"] : []),
        ...(install.exact ? ["--save-exact"] : []),
        ...install.packages,
      ];
    case "pnpm":
      return [
        "add",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--ignore-workspace",
        "--dir",
        folder,
        ...(install.dev ? ["--save-dev"] : []),
        ...(install.exact ? ["--save-exact"] : []),
        ...install.packages,
      ];
    case "bun":
      return [
        "add",
        "--ignore-scripts",
        "--config=/dev/null",
        `--cwd=${folder}`,
        ...(install.dev ? ["--dev"] : []),
        ...(install.exact ? ["--exact"] : []),
        ...install.packages,
      ];
  }
}

/**
 * Before the package manager starts, in the login shell that finds it: no setting from the
 * grown-up's shell or the engine steers it, its own user and global config are empty, and
 * corepack neither follows the project's "packageManager" nor fetches one from an address.
 */
export const INSTALL_SHELL_SETUP =
  "unset -m 'npm_config_*' 'NPM_CONFIG_*' 'pnpm_config_*' 'PNPM_CONFIG_*' 'BUN_CONFIG_*' 'COREPACK_*' NODE_OPTIONS; " +
  "export npm_config_userconfig=/dev/null npm_config_globalconfig=/var/empty/skycot-npmrc XDG_CONFIG_HOME=/dev/null " +
  // The flag alone doesn't reach the nested install npm runs to prepare a git dependency.
  "npm_config_ignore_scripts=true " +
  "COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_UNSAFE_CUSTOM_URLS=0 COREPACK_ENABLE_AUTO_PIN=0 COREPACK_ENABLE_STRICT=0; ";

/** The whole command line SKYCOT's login shell runs for an approved install. */
export function installCommand(install: ApprovedInstall, folder: string): string {
  return (
    INSTALL_SHELL_SETUP +
    [install.manager, ...installArguments(install, folder)].map(quote).join(" ")
  );
}

/** Settings files in the project a package manager reads and SKYCOT can't switch off. */
const UNSWITCHABLE_SETTINGS: Record<ApprovedInstall["manager"], ReadonlyArray<string>> = {
  npm: [".npmrc"],
  pnpm: [".npmrc", "pnpm-workspace.yaml"],
  bun: [".npmrc"],
};
/** What the install writes or reads: never a link. */
const INSTALL_FILES = [
  "node_modules",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
];

function lstatOrNull(path: string): NodeFS.Stats | null {
  try {
    return NodeFS.lstatSync(path);
  } catch {
    return null;
  }
}

/** A dependency spec that isn't a registry version: git, a web address, a folder or a tarball. */
const FETCHED_SPEC =
  /^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:|ssh:|https?:|file:|link:|portal:|workspace:)|^[\w.-]+\/[\w.-]+(?:#.*)?$|\.(?:tgz|tar\.gz|tar)$/i;
/** The same kinds of source as they appear in a lockfile. */
const FETCHED_IN_LOCKFILE = /git\+|git:\/\/|github:|codeload\.github\.com|\bfile:|\blink:/;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
  "pnpm",
];

/** Where a dependency the project already lists would be fetched from, when not the registry. */
function fetchedDependency(folder: string): string | null {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(NodeFS.readFileSync(NodePath.join(folder, "package.json"), "utf8"));
  } catch {
    manifest = {};
  }
  const specs: Array<string> = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") specs.push(value);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const field of DEPENDENCY_FIELDS) collect(manifest[field]);
  if (specs.some((spec) => FETCHED_SPEC.test(spec.trim()))) return "outside the add-on registry";
  for (const lockfile of [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "bun.lock",
  ]) {
    let text: string;
    try {
      text = NodeFS.readFileSync(NodePath.join(folder, lockfile), "utf8");
    } catch {
      continue;
    }
    if (FETCHED_IN_LOCKFILE.test(text)) return `outside the add-on registry (in ${lockfile})`;
  }
  return null;
}

/**
 * Why SKYCOT won't run this install in `folder` (a sentence for the assistant's note), or null.
 * Reads only; called just before the install, after the grown-up's yes.
 */
export function installRefusal(folder: string, manager: ApprovedInstall["manager"]): string | null {
  let real: string;
  try {
    real = NodeFS.realpathSync.native(folder);
  } catch {
    return "the project's folder isn't there.";
  }
  for (const name of UNSWITCHABLE_SETTINGS[manager]) {
    if (lstatOrNull(NodePath.join(real, name)) !== null) {
      return `this project has its own ${name} settings file, and SKYCOT only installs add-ons with its own settings. Delete ${name} from the project and ask again, or ask a grown-up.`;
    }
  }
  for (const name of INSTALL_FILES) {
    if (lstatOrNull(NodePath.join(real, name))?.isSymbolicLink()) {
      return `${name} in this project is a link to somewhere else, so SKYCOT won't install into it.`;
    }
  }
  // Read only after the link checks above, so this never reads through a link.
  const fetched = fetchedDependency(real);
  if (fetched !== null) {
    return `this project lists an add-on that comes from ${fetched}, and installing it would run its own setup. Ask a grown-up.`;
  }
  const modules = NodePath.join(real, "node_modules");
  const entries = (dir: string) => {
    try {
      return NodeFS.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const entry of entries(modules)) {
    const inside = entry.name.startsWith("@")
      ? entries(NodePath.join(modules, entry.name)).map((sub) =>
          NodePath.join(modules, entry.name, sub.name),
        )
      : [NodePath.join(modules, entry.name)];
    for (const path of inside) {
      if (!lstatOrNull(path)?.isSymbolicLink()) continue;
      let target: string;
      try {
        target = NodeFS.realpathSync.native(path);
      } catch {
        return "an add-on folder in node_modules is a broken link, so SKYCOT won't install into it.";
      }
      const relative = NodePath.relative(real, target);
      if (relative.startsWith("..") || NodePath.isAbsolute(relative)) {
        return "an add-on folder in node_modules is a link to somewhere outside this project, so SKYCOT won't install into it.";
      }
    }
  }
  return null;
}

const quote = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

const GROWN_UP_SAID_YES = "it was approved";

/** Why SKYCOT did it, for the assistant's note: the policy's relief, else a person's yes. */
export function becauseFor(relief: string | undefined): string {
  switch (relief) {
    case "trusted-add-on":
      return "this is a trusted add-on";
    case "approved-before":
      return "it was already approved in this conversation";
    default:
      return "it was approved";
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

export type DownloadOutcome =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Put a downloaded file at `download.output` inside `folder`, making `download.folders` first,
 * through no link (see the header): never outside the project's real folder.
 */
export function writeDownloadInside(
  folder: string,
  download: Pick<ApprovedDownload, "output" | "folders">,
  body: Uint8Array,
): DownloadOutcome {
  const outside = { ok: false, reason: "it would have gone outside this project." } as const;
  let root: string;
  try {
    root = NodeFS.realpathSync.native(folder);
  } catch {
    return { ok: false, reason: "the project's folder isn't there." };
  }
  const insideRoot = (path: string) => {
    const relative = NodePath.relative(root, path);
    return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
  };
  // Every folder on the way: a real folder, made one step at a time when missing.
  const ensureFolder = (relative: string): boolean => {
    let current = root;
    for (const part of NodePath.normalize(relative).split(NodePath.sep)) {
      if (part === "" || part === ".") continue;
      if (part === "..") return false;
      current = NodePath.join(current, part);
      const stat = lstatOrNull(current);
      if (stat === null) {
        NodeFS.mkdirSync(current);
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    }
    return true;
  };
  const target = NodePath.resolve(root, download.output);
  if (!insideRoot(target)) return outside;
  try {
    for (const name of download.folders ?? []) {
      if (!insideRoot(NodePath.resolve(root, name)) || !ensureFolder(name)) {
        return { ok: false, reason: "a folder would have gone outside this project." };
      }
    }
    const parent = NodePath.dirname(target);
    if (!ensureFolder(NodePath.relative(root, parent))) return outside;
    if (lstatOrNull(target)?.isDirectory()) {
      return { ok: false, reason: "a folder of that name is already there." };
    }
    const temporary = NodePath.join(
      parent,
      `.skycot-download-${NodeCrypto.randomBytes(8).toString("hex")}`,
    );
    const handle = NodeFS.openSync(
      temporary,
      NodeFS.constants.O_WRONLY |
        NodeFS.constants.O_CREAT |
        NodeFS.constants.O_EXCL |
        NodeFS.constants.O_NOFOLLOW,
      0o644,
    );
    try {
      NodeFS.writeFileSync(handle, body);
    } finally {
      NodeFS.closeSync(handle);
    }
    // The folder may have been swapped for a link since it was checked.
    const realParent = NodeFS.realpathSync.native(parent);
    if (realParent !== root && !insideRoot(realParent)) {
      NodeFS.rmSync(temporary, { force: true });
      return outside;
    }
    NodeFS.renameSync(temporary, target);
    return { ok: true, bytes: body.byteLength };
  } catch {
    return { ok: false, reason: "SKYCOT couldn't save the file in this project." };
  }
}

/** Fetch one https file into the folder, with a size limit; never outside the folder. */
const downloadInto = Effect.fn("SkycotApprovedInstalls.download")(function* (
  folder: string,
  download: ApprovedDownload,
) {
  const client = yield* HttpClient.HttpClient;
  const target = NodePath.resolve(folder, download.output);
  const relative = NodePath.relative(folder, target);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) {
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
  return writeDownloadInside(folder, download, body);
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
      const sandboxed =
        driver === "codex" ||
        (driver === "claudeAgent" &&
          Option.isSome(family) &&
          (yield* family.value.isEnabled.pipe(Effect.orElseSucceed(() => false))));
      if (!sandboxed) return null;
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
      const steers = driver === "codex";
      return install !== null
        ? ({ kind: "install", install, folder: projectRoot, names, trusted, steers } as const)
        : ({
            kind: "download",
            download: download!,
            folder: projectRoot,
            names,
            trusted,
            steers,
          } as const);
    });

    type RespondInput = Parameters<
      RuntimeRequestService.RuntimeRequestServiceV2Shape["respond"]
    >[0];

    /** The note, then "decline" so the assistant's own copy never runs. */
    const skipWithNote = Effect.fnUntraced(function* (
      input: RespondInput,
      text: string,
      steers: boolean,
    ) {
      if (!steers) {
        return yield* base.respond({
          ...input,
          decision: "decline",
          answers: { ...input.answers, [SkycotFamilyClaude.ASSISTANT_NOTE_ANSWER]: text },
        });
      }
      yield* tellAssistant(input, text).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot-installs.note-not-delivered", { cause }),
        ),
      );
      return yield* base.respond({ ...input, decision: "decline" });
    });

    const tellAssistant = Effect.fnUntraced(function* (input: RespondInput, text: string) {
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
          const fetched = yield* downloadInto(plan.folder, plan.download).pipe(
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
          return yield* skipWithNote(
            input,
            noteForDownload(plan.download, fetched, because),
            plan.steers,
          );
        }

        // The add-ons are not something the child made: keep them out of "What changed" and
        // the versions, for a folder that started keeping versions before SKYCOT did this.
        yield* keepAddOnsOutOfVersions(gitThroughRunner(runner, plan.folder), plan.folder, {
          unlessIgnored: true,
        });

        const refused = installRefusal(plan.folder, plan.install.manager);
        if (refused !== null) {
          yield* Effect.logInfo("skycot-installs.install-refused", {
            manager: plan.install.manager,
            packages: plan.install.packages,
          });
          return yield* skipWithNote(
            input,
            noteForAssistant(plan.install, { ok: false, reason: refused }, because),
            plan.steers,
          );
        }
        const command = installCommand(plan.install, plan.folder);
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
        return yield* skipWithNote(
          input,
          noteForAssistant(plan.install, outcome, because),
          plan.steers,
        );
      }),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
