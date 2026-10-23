// While the Family profile is on, the RPCs that publish, schedule, install, open the developer
// tools, or allow a risky step need a grown-up: a grant the parent code opened for this
// session (SkycotFamily.verify). Checked in the WebSocket RPC middleware, beside the scope
// check, so a raw RPC from any client (the plain client, Advanced mode, a script with the
// session cookie) meets the same rule as a click.
//
// The Family limits (bedtime, daily time, messages a day, the allowance line) are checked here
// too, at every turn start: a child's message is refused while SKYCOT is asleep for them, and
// so is allowing the next step of a turn already running ("finish the current step, then
// pause"). The step that is running finishes; nothing is interrupted half-way, so a project is
// never left half-edited.
//
// Plan first is decided here too, for the provider layer: a message that builds an approved
// plan (`message.dispatch` with `sourcePlanRef`), or one sent by a grown-up in Advanced mode,
// may run without planning; every other turn of the child's runs as a plan
// (SkycotFamilyInstructions.familyTurnInput).
//
// Agents reach the same capabilities through T3's MCP tools, which this gate does not see;
// those are closed separately: while the profile is on, ProviderSessionManager issues a thread no
// MCP credential at all (seam skycot-family-mcp), so the agent is given no engine tool server and
// none of its tools (thread control, worktrees, pull requests, devices, page previews, and
// html_render / html_preview, which may first download a browser) is listed or callable.

import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  ORCHESTRATION_V2_WS_METHODS,
  RpcScopeAuthorization,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ProviderDriverKind,
  type RuntimeRequestId,
  type ThreadId,
  authScopeRequiredResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import {
  deleteConversationApprovalId,
  evaluateFamilyRequest,
  type FamilyEvaluation,
} from "@t3tools/skycot-rules/family";
import { isLocalPreviewAddress } from "@t3tools/skycot-rules/preview";
import { isInQuestionsSpace, workRootsFor } from "@t3tools/skycot-rules/questions";
import {
  findPersonalDetails,
  personalCategories,
  shieldApprovalId,
} from "@t3tools/skycot-rules/personal";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyInstructions from "./SkycotFamilyInstructions.ts";
import { requestFacts } from "./SkycotPolicy.ts";
import * as SkycotQuestions from "./questions/SkycotQuestions.ts";

/** `requiredPermission` on the refusal, so a client can tell "ask a grown-up" from a scope error. */
export const FAMILY_PERMISSION = "skycot:family-parent-code";

/** `requiredPermission` when SKYCOT is asleep for the child: the client shows its asleep screen. */
export const FAMILY_ASLEEP_PERMISSION = "skycot:family-asleep";

export const FAMILY_REFUSAL_MESSAGE =
  "The Family profile is on, so a grown-up needs to enter the parent code first.";

type Purpose = SkycotFamily.FamilyPurpose;

/** What a gated call needs, or null when it is open to the child. */
export type GateNeed =
  | {
      readonly type: "grant";
      readonly purpose: Purpose;
      /** For "approve": the one thing the grown-up said yes to (Advanced mode's grant also opens it). */
      readonly requestId?: string;
      /** For "approve": the yes is spent by this call. */
      readonly consume?: boolean;
    }
  /** Open inside a project SKYCOT already has; anywhere else is opening another folder. */
  | { readonly type: "projectFolder"; readonly cwd: string }
  /**
   * A conversation's private copy of a project SKYCOT already has. The engine picks the
   * place (its own worktrees folder) and copies from this Mac's history, and the copy is
   * what makes Undo possible, so it is open; an unknown project is opening another folder.
   */
  | { readonly type: "projectWorktree"; readonly projectId: ProjectId }
  /**
   * A new project at this folder. Inside SKYCOT's Questions space it is "Make this a project"
   * (a question's own folder becomes a project), which is the child's own work; anywhere else
   * it is opening another folder.
   */
  | { readonly type: "newProject"; readonly cwd: string }
  /**
   * Taking a project off the list (its files stay). For a project made from a question, that
   * is the Undo of "Make this a project", so it is open; any other project is a grown-up's.
   */
  | { readonly type: "removeProject"; readonly projectId: ProjectId }
  | {
      readonly type: "respond";
      readonly threadId: ThreadId;
      readonly requestId: RuntimeRequestId;
      /** "Allow for the session" / "always": widens future steps, so always a grown-up's call. */
      readonly widens: boolean;
    };

const PUBLISH_METHODS = new Set([
  "pullRequests.runAction",
  "pullRequests.update",
  "pullRequests.comment",
  "pullRequests.updateComment",
  "pullRequests.submitReview",
  "pullRequests.replyToThread",
  "pullRequests.setThreadResolution",
  "pullRequests.setReaction",
  "pullRequests.requestReviewers",
  "pullRequests.setLabels",
  "sourceControl.publishRepository",
]);
const AUTOMATION_METHODS = new Set([
  "scheduledTasks.upsert",
  "scheduledTasks.runNow",
  "scheduledTasks.rotateWebhookToken",
]);
/**
 * Setting up the AI assistants: the parent's accounts, sign-ins, tools and launch options,
 * the app's own settings, and anything that sends the parent's data or credentials onward.
 */
const SETTINGS_METHODS = new Set([
  "provider.install.start",
  "provider.install.remove",
  "server.updateProvider",
  "provider.auth.start",
  "provider.auth.complete",
  "provider.auth.respond",
  "provider.auth.logout",
  "provider.chatgpt.reconnect-profile",
  "provider.chatgpt.import-profile",
  "provider.consumeResetCredit",
  "provider.uploadFeedback",
  "server.upsertKeybinding",
  "server.removeKeybinding",
]);
/** Folders outside the project, or a copy of someone else's code from the internet. */
const OPEN_FOLDER_METHODS = new Set([
  "projects.add",
  "projects.remove",
  "sourceControl.cloneRepository",
  "projectClone.start",
  "projectClone.retry",
  "vcs.createWorktree",
  "vcs.removeWorktree",
]);
/** The developer tools: terminals, updates, outside agents, devices, data clean-up, remotes. */
const ADVANCED_METHODS = new Set([
  "terminal.open",
  "terminal.attach",
  "terminal.write",
  "terminal.restart",
  "server.updateServer",
  "server.updateServerWithProgress",
  "server.commitDesktopUpdate",
  "server.prepareAcpRegistryAgent",
  "server.uninstallAcpRegistryManagedBinary",
  "server.acceptAcpRegistryUrlAuth",
  "server.setAcpRegistryProvider",
  "server.disableAcpRegistryProvider",
  "server.importAcpRegistrySession",
  "server.deleteAcpRegistrySession",
  "server.logoutAcpRegistry",
  "server.signalProcess",
  "server.runStorageCleanup",
  "server.checkOtlpEndpoint",
  "cloud.installRelayClient",
  "shell.openInEditor",
  "device.configure",
  "device.testHost",
  "device.open",
  "device.close",
  "device.shutdown",
  "device.action",
  "agentSessions.import",
  "mcpApps.callTool",
  "vcs.pull",
  "git.resolvePullRequest",
  "git.preparePullRequestThread",
]);

/**
 * A preview of the child's own work runs on this Mac; anything else is the internet. Shared with
 * the live preview (`skycot/preview`), so a typed address and the preview panel agree.
 */
function isLocalPreviewUrl(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("about:") || value.startsWith("file:")) return true;
  return isLocalPreviewAddress(value);
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * Settings the plain client writes on its own: "Ask me first" as the default. Anything else
 * (providers and their launch arguments, MCP servers, other runtime modes) is a grown-up's
 * change, because a provider's launch arguments can switch its permission checks off.
 */
function isChildSafeSettingsPatch(payload: unknown): boolean {
  const input = record(payload);
  if (input["providerInstanceMutation"] !== undefined) return false;
  const patch = record(input["patch"]);
  const keys = Object.keys(patch).filter((key) => patch[key] !== undefined);
  return keys.every((key) => key === "defaultRuntimeMode" && patch[key] === "approval-required");
}

/** What every project change carries besides the change itself. */
const PROJECT_UPDATE_ENVELOPE: ReadonlySet<string> = new Set(["type", "commandId", "projectId"]);
/** The project changes a child may make: its name and its icon. */
const CHILD_PROJECT_CHANGES: ReadonlySet<string> = new Set(["title", "projectIcon"]);

/** Pure: which grown-up check a call needs. Exported for tests. */
export function gateNeedFor(method: string, payload: unknown): GateNeed | null {
  const input = record(payload);
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand) {
    // A conversation pointed at another folder lets the assistant work there.
    if (input["type"] === "thread.create") {
      return typeof input["worktreePath"] === "string"
        ? { type: "projectFolder", cwd: input["worktreePath"] }
        : null;
    }
    // Putting away, bringing back and renaming are open to the child (each can be undone);
    // pointing the conversation at another folder through the same command is not.
    if (input["type"] === "thread.metadata.update") {
      return typeof input["worktreePath"] === "string"
        ? { type: "projectFolder", cwd: input["worktreePath"] }
        : null;
    }
    // Deleting a conversation cannot be undone (putting it away can), so it is a grown-up's
    // call: a parent code for this one conversation (spent by the delete), or Advanced mode.
    // Not the Advanced grant itself: that would also lift plan first and the limits for the
    // child's session while it lasts.
    if (input["type"] === "thread.delete") {
      return typeof input["threadId"] === "string"
        ? {
            type: "grant",
            purpose: "approve",
            requestId: deleteConversationApprovalId(input["threadId"]),
            consume: true,
          }
        : { type: "grant", purpose: "advanced" };
    }
    if (input["type"] !== "runtime-request.respond") return null;
    const decision = input["decision"];
    if (decision !== "accept" && decision !== "acceptForSession" && decision !== "acceptAlways") {
      return null;
    }
    return {
      type: "respond",
      threadId: input["threadId"] as ThreadId,
      requestId: input["requestId"] as RuntimeRequestId,
      widens: decision !== "accept",
    };
  }
  if (method === ORCHESTRATION_V2_WS_METHODS.launchThread) {
    const workspace = record(input["workspaceStrategy"]);
    if (
      workspace["type"] === "existing_worktree" &&
      typeof workspace["worktreePath"] === "string"
    ) {
      return { type: "projectFolder", cwd: workspace["worktreePath"] };
    }
    if (workspace["type"] !== "worktree") return null;
    // Starting from the internet's copy of the branch fetches first: a remote operation.
    if (workspace["startFromOrigin"] === true || typeof input["projectId"] !== "string") {
      return { type: "grant", purpose: "openFolder" };
    }
    return { type: "projectWorktree", projectId: input["projectId"] as ProjectId };
  }
  if (method === "git.runStackedAction") {
    return input["action"] === "commit" ? null : { type: "grant", purpose: "publish" };
  }
  if (PUBLISH_METHODS.has(method)) return { type: "grant", purpose: "publish" };
  if (AUTOMATION_METHODS.has(method)) return { type: "grant", purpose: "automation" };
  // Pausing an automation is always fine; switching one on is setting it up again.
  if (method === "scheduledTasks.setEnabled") {
    return input["enabled"] === false ? null : { type: "grant", purpose: "automation" };
  }
  if (method === "projects.mutate") {
    if (input["type"] === "project.update") {
      const changed = Object.keys(input).filter(
        (key) => !PROJECT_UPDATE_ENVELOPE.has(key) && input[key] !== undefined,
      );
      // A project's scripts run commands, and its other settings pick the assistant, pull from
      // the internet or change where conversations work: the developer tools' business.
      if (changed.some((key) => !CHILD_PROJECT_CHANGES.has(key) && key !== "workspaceRoot")) {
        return { type: "grant", purpose: "advanced" };
      }
      // Moving a project's folder is opening another folder.
      if (changed.includes("workspaceRoot")) return { type: "grant", purpose: "openFolder" };
      // Renaming and changing the icon stay open (each can be undone).
      return null;
    }
    // Adding a folder needs a grown-up, unless it is the child's own question ("Make this a project").
    if (input["type"] === "project.create" && typeof input["workspaceRoot"] === "string") {
      return { type: "newProject", cwd: input["workspaceRoot"] };
    }
    // `force` also removes the project's conversations: never the child's call.
    if (
      input["type"] === "project.delete" &&
      typeof input["projectId"] === "string" &&
      input["force"] !== true
    ) {
      return { type: "removeProject", projectId: input["projectId"] as ProjectId };
    }
    return { type: "grant", purpose: "openFolder" };
  }
  if (OPEN_FOLDER_METHODS.has(method)) return { type: "grant", purpose: "openFolder" };
  if (method === "projects.writeFile") {
    return typeof input["cwd"] === "string"
      ? { type: "projectFolder", cwd: input["cwd"] }
      : { type: "grant", purpose: "openFolder" };
  }
  if (method === "secrets.answerRequest") {
    // Declining is always fine; handing the assistant a key or password is a grown-up's call.
    return record(input["answer"])["type"] === "decline"
      ? null
      : { type: "grant", purpose: "settings" };
  }
  if (method === "preview.open" || method === "preview.navigate") {
    return isLocalPreviewUrl(input["url"]) ? null : { type: "grant", purpose: "advanced" };
  }
  if (method === "server.updateSettings") {
    return isChildSafeSettingsPatch(payload) ? null : { type: "grant", purpose: "settings" };
  }
  if (SETTINGS_METHODS.has(method)) return { type: "grant", purpose: "settings" };
  if (ADVANCED_METHODS.has(method)) return { type: "grant", purpose: "advanced" };
  return null;
}

/** Commands that start (or continue with) a message from the child: each is a turn. */
const TURN_COMMANDS = new Set([
  "message.dispatch",
  "queue.resume",
  "queued-message.promote-to-steer",
  "prepared-run.release",
  "prepared-run.retry",
]);

export interface TurnStart {
  readonly threadId: string | undefined;
  /** The assistant it runs on when the call says so; otherwise the thread's. */
  readonly instanceId: string | undefined;
}

/** Pure: whether a call starts a turn, for the Family limits. Exported for tests. */
export function turnStartFor(method: string, payload: unknown): TurnStart | null {
  const input = record(payload);
  const threadId = typeof input["threadId"] === "string" ? input["threadId"] : undefined;
  const selection = record(input["modelSelection"]);
  const instanceId =
    typeof selection["instanceId"] === "string" ? selection["instanceId"] : undefined;
  if (method === ORCHESTRATION_V2_WS_METHODS.launchThread) {
    return input["initialMessage"] === undefined ? null : { threadId, instanceId };
  }
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand) {
    return typeof input["type"] === "string" && TURN_COMMANDS.has(input["type"])
      ? { threadId, instanceId }
      : null;
  }
  return null;
}

/** Pure: the conversation or project a call starts, so the engine can remember whose it is. */
export function startedBy(
  method: string,
  payload: unknown,
): { readonly threadId?: string; readonly projectId?: string } | null {
  const input = record(payload);
  const text = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;
  if (method === ORCHESTRATION_V2_WS_METHODS.launchThread) {
    if (input["reuseExistingThread"] === true) return null;
    return {
      ...(text("threadId") ? { threadId: text("threadId")! } : {}),
      ...(text("projectId") ? { projectId: text("projectId")! } : {}),
    };
  }
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand && input["type"] === "thread.create") {
    return text("threadId") ? { threadId: text("threadId")! } : null;
  }
  if (method === "projects.mutate" && input["type"] === "project.create") {
    return text("projectId") ? { projectId: text("projectId")! } : null;
  }
  return null;
}

/** Pure: the child's message a call sends, if it sends one. Exported for tests. */
export function sentMessage(
  method: string,
  payload: unknown,
): { readonly messageId: string; readonly text: string; readonly threadId?: string } | null {
  const input = record(payload);
  const threadId = typeof input["threadId"] === "string" ? input["threadId"] : undefined;
  const message =
    method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand && input["type"] === "message.dispatch"
      ? input
      : method === ORCHESTRATION_V2_WS_METHODS.launchThread
        ? record(input["initialMessage"])
        : null;
  if (message === null || typeof message["messageId"] !== "string") return null;
  return {
    messageId: message["messageId"],
    text: typeof message["text"] === "string" ? message["text"] : "",
    ...(threadId ? { threadId } : {}),
  };
}

/**
 * Pure: whether a call builds a proposed plan (Build it). The engine itself refuses a
 * `sourcePlanRef` that is not a live plan of the same project, so the gate only reads it.
 */
export function buildsPlan(method: string, payload: unknown): boolean {
  const input = record(payload);
  return (
    method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand &&
    input["type"] === "message.dispatch" &&
    typeof record(input["sourcePlanRef"])["planId"] === "string"
  );
}

/**
 * The same rule for the HTTP API routes that change things (`/api/projects/mutate` is the
 * HTTP twin of `projects.mutate`). Revoking access stays open: it only ever takes away.
 */
const ADVANCED_HTTP_ROUTES = new Set([
  "/api/auth/pairing-token",
  "/api/connect/link-proof",
  "/api/connect/relay-config",
  "/api/connect/unlink",
  "/api/connect/preferences",
  "/api/connect/mint-credential",
  "/api/t3-connect/mint-credential",
]);

/** Whether a request's route is one the Family profile judges (read before the body is). */
export function isGatedHttpRoute(method: string, pathname: string): boolean {
  return (
    method === "POST" &&
    (ADVANCED_HTTP_ROUTES.has(pathname) ||
      pathname === "/api/projects/mutate" ||
      pathname === "/oauth/mcp/decision")
  );
}

/** Pure: which grown-up check an HTTP API call needs. Exported for tests. */
export function gateNeedForHttp(method: string, pathname: string, body: unknown): GateNeed | null {
  if (!isGatedHttpRoute(method, pathname)) return null;
  if (pathname === "/api/projects/mutate") return gateNeedFor("projects.mutate", body);
  if (pathname === "/oauth/mcp/decision") {
    // Letting an outside agent in is the developer tools' business; saying no never is.
    return record(record(body)["decision"])["_tag"] === "deny"
      ? null
      : { type: "grant", purpose: "advanced" };
  }
  return { type: "grant", purpose: "advanced" };
}

export const familyRefusal = () =>
  new EnvironmentAuthorizationError({
    message: FAMILY_REFUSAL_MESSAGE,
    ...authScopeRequiredResponse(AuthOrchestrationOperateScope),
    requiredPermission: FAMILY_PERMISSION,
  });

/** SKYCOT is asleep for this child: the engine's own sentence, and a permission the client knows. */
export const asleepRefusal = (refusal: SkycotFamilyLimits.FamilyLimitRefusal) =>
  new EnvironmentAuthorizationError({
    message: refusal.sentence,
    ...authScopeRequiredResponse(AuthOrchestrationOperateScope),
    requiredPermission: FAMILY_ASLEEP_PERMISSION,
  });

export class SkycotFamilyGate extends Context.Service<
  SkycotFamilyGate,
  {
    /** Fails with a plain refusal when the Family profile needs a grown-up for this call. */
    readonly check: (input: {
      readonly sessionId: string;
      readonly method: string;
      readonly payload: unknown;
    }) => Effect.Effect<void, EnvironmentAuthorizationError>;
    /** The same check for an HTTP API route (`isGatedHttpRoute`). */
    readonly checkHttp: (input: {
      readonly sessionId: string;
      readonly method: string;
      readonly pathname: string;
      readonly payload: unknown;
    }) => Effect.Effect<void, EnvironmentAuthorizationError>;
    /** Whether only a grown-up may allow this pending request (false while the profile is off). */
    readonly requestNeedsGrownUp: (input: {
      readonly threadId: ThreadId;
      readonly requestId: RuntimeRequestId;
    }) => Effect.Effect<boolean>;
  }
>()("t3/skycot/SkycotFamilyGate") {}

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;

const make = Effect.gen(function* () {
  const family = yield* SkycotFamily.SkycotFamily;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  // Optional so a gate built without the limits (older tests, tools) keeps its old behaviour.
  const limits = yield* Effect.serviceOption(SkycotFamilyLimits.SkycotFamilyLimits);
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;

  /**
   * Where the thread works (its private copy, else the folder), and the project's folder. A
   * question works in its own folder only (`workRootsFor`).
   */
  const projectRootsFor = Effect.fnUntraced(function* (thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) {
    const project = yield* projects.get(thread.projectId);
    const projectFolder = Option.isSome(project) ? project.value.workspaceRoot : null;
    return workRootsFor({ projectFolder, worktreePath: thread.worktreePath, questionsRoot });
  });

  const toolCallFor = Effect.fnUntraced(function* (
    threadId: ThreadId,
    approval: ApprovalItem,
    driver: ProviderDriverKind | undefined,
  ) {
    const ref = approval.nativeItemRef;
    const itemDriver = ref?.driver ?? driver;
    if (ref === null || ref.nativeId === null || itemDriver === undefined) return null;
    return yield* projections.getTurnItem({
      threadId,
      itemId: IdAllocator.derive.turnItemFromProviderItem({
        driver: itemDriver,
        nativeItemId: ref.nativeId,
      }),
    });
  });

  /**
   * The same facts the policy reactor reads, judged by the Family rules. Anything that cannot
   * be read is held: a gate that cannot see what it is judging must not say yes.
   */
  const evaluate = Effect.fn("SkycotFamilyGate.evaluate")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: RuntimeRequestId;
  }) {
    const thread = yield* projections.getThread(input.threadId);
    const approval = yield* projections.getTurnItem({
      threadId: input.threadId,
      itemId: IdAllocator.derive.approvalTurnItem({ requestId: input.requestId }),
    });
    if (approval === null || approval.type !== "approval_request") return null;
    const driver = approval.nativeItemRef?.driver;
    const toolCall = yield* toolCallFor(input.threadId, approval, driver);
    const facts = requestFacts(approval, toolCall, driver);
    if (facts === null) return null;
    return evaluateFamilyRequest(
      { ...facts, toolItemType: toolCall?.type },
      yield* projectRootsFor(thread),
    ) satisfies FamilyEvaluation;
  });

  const requestNeedsGrownUp: SkycotFamilyGate["Service"]["requestNeedsGrownUp"] = (input) =>
    family.isEnabled.pipe(
      Effect.flatMap((enabled) =>
        enabled
          ? evaluate(input).pipe(
              Effect.map((evaluation) => evaluation === null || evaluation.needsGrownUp),
              Effect.orElseSucceed(() => true),
            )
          : Effect.succeed(false),
      ),
    );

  // A question's own folder is SKYCOT's space, not the person's: open like a project's.
  const isProjectFolder = (cwd: string) =>
    isInQuestionsSpace(cwd, questionsRoot)
      ? Effect.succeed(true)
      : projects.findActiveByWorkspaceRoot(cwd.replace(/[/\\]+$/, "")).pipe(
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => false),
        );

  const isQuestionProject = (projectId: ProjectId) =>
    projects.get(projectId).pipe(
      Effect.map(
        (project) =>
          Option.isSome(project) && isInQuestionsSpace(project.value.workspaceRoot, questionsRoot),
      ),
      Effect.orElseSucceed(() => false),
    );

  const isKnownProject = (projectId: ProjectId) =>
    projects.get(projectId).pipe(
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
    );

  const enforce = Effect.fn("SkycotFamilyGate.enforce")(function* (
    sessionId: string,
    method: string,
    need: GateNeed | null,
  ) {
    if (need === null) return;
    if (!(yield* family.isEnabled)) return;
    if (
      need.type === "projectFolder" ||
      need.type === "projectWorktree" ||
      need.type === "newProject" ||
      need.type === "removeProject"
    ) {
      if (
        need.type === "projectFolder"
          ? yield* isProjectFolder(need.cwd)
          : need.type === "newProject"
            ? isInQuestionsSpace(need.cwd, questionsRoot)
            : need.type === "removeProject"
              ? yield* isQuestionProject(need.projectId)
              : yield* isKnownProject(need.projectId)
      )
        return;
      if (yield* family.allows({ sessionId, purpose: "openFolder" })) return;
      yield* Effect.logInfo("skycot-family.refused", { method, purpose: "openFolder" });
      return yield* familyRefusal();
    }
    if (need.type === "grant") {
      if (
        yield* family.allows({
          sessionId,
          purpose: need.purpose,
          ...(need.requestId === undefined ? {} : { requestId: need.requestId }),
          ...(need.consume === true ? { consume: true } : {}),
        })
      )
        return;
      yield* Effect.logInfo("skycot-family.refused", { method, purpose: need.purpose });
      return yield* familyRefusal();
    }
    const grownUp =
      need.widens ||
      (yield* requestNeedsGrownUp({ threadId: need.threadId, requestId: need.requestId }));
    if (!grownUp) {
      // An ordinary step the child may allow: not while SKYCOT is asleep for them.
      if (Option.isSome(limits)) {
        yield* limits.value.admitStep({ sessionId }).pipe(Effect.mapError(asleepRefusal));
      }
      return;
    }
    const allowed = yield* family.allows({
      sessionId,
      purpose: "approve",
      requestId: need.requestId,
      consume: true,
    });
    if (allowed) {
      if (Option.isSome(limits)) {
        yield* limits.value.recordEvent({ sessionId, kind: "approved", threadId: need.threadId });
      }
      return;
    }
    yield* Effect.logInfo("skycot-family.refused", { method, requestId: need.requestId });
    return yield* familyRefusal();
  });

  /** A turn start meets the limits; a grown-up working in Advanced mode is not a child. */
  const admit = Effect.fn("SkycotFamilyGate.admit")(function* (
    sessionId: string,
    method: string,
    payload: unknown,
  ) {
    if (Option.isNone(limits)) return;
    const turn = turnStartFor(method, payload);
    const started = startedBy(method, payload);
    if (turn === null && started === null) return;
    if (!(yield* family.isEnabled)) return;
    if (turn !== null && !(yield* family.allows({ sessionId, purpose: "advanced" }))) {
      const instanceId =
        turn.instanceId ??
        (turn.threadId === undefined
          ? undefined
          : yield* projections.getThread(turn.threadId as ThreadId).pipe(
              Effect.map((thread) => String(thread.providerInstanceId)),
              Effect.orElseSucceed(() => undefined),
            ));
      yield* limits.value.admitTurn({ sessionId, instanceId }).pipe(
        Effect.tapError((refusal) =>
          Effect.logInfo("skycot-family.refused", { method, asleep: refusal.reason }),
        ),
        Effect.mapError(asleepRefusal),
      );
    }
    if (started !== null) yield* limits.value.recordStart({ sessionId, ...started });
  });

  /**
   * A grown-up who allowed this one message as typed (the shield card's parent code, an
   * `approve` grant for `shield:<messageId>`): the provider layer only sees the message, not
   * the session, so the pass is left there. Spent here, after the limits let the call through,
   * so a message refused at bedtime does not use up the parent's yes. What the shield does
   * with a message is noted for the recap by kind only, never the words.
   */
  const passShield = Effect.fn("SkycotFamilyGate.passShield")(function* (
    sessionId: string,
    method: string,
    payload: unknown,
  ) {
    const message = sentMessage(method, payload);
    if (message === null || !(yield* family.isEnabled)) return;
    const categories = personalCategories(findPersonalDetails(message.text));
    const allowed = yield* family.allows({
      sessionId,
      purpose: "approve",
      requestId: shieldApprovalId(message.messageId),
      consume: true,
    });
    if (allowed) yield* SkycotFamilyInstructions.allowPersonalDetailsOnce(message.messageId);
    if (categories.length === 0 || Option.isNone(limits)) return;
    yield* limits.value.recordEvent({
      sessionId,
      kind: allowed ? "shield-allowed" : "shield",
      categories,
      threadId: message.threadId,
    });
  });

  /**
   * Plan first: the messages that may run without a plan. Left after the limits let the call
   * through, like the shield's pass.
   */
  const passPlan = Effect.fn("SkycotFamilyGate.passPlan")(function* (
    sessionId: string,
    method: string,
    payload: unknown,
  ) {
    const message = sentMessage(method, payload);
    if (message === null || !(yield* family.isEnabled)) return;
    if (buildsPlan(method, payload)) {
      yield* SkycotFamilyInstructions.letRunWithoutPlan(message.messageId, "builds-plan");
    } else if (yield* family.allows({ sessionId, purpose: "advanced" })) {
      yield* SkycotFamilyInstructions.letRunWithoutPlan(message.messageId, "grown-up");
    }
  });

  const check: SkycotFamilyGate["Service"]["check"] = (input) =>
    Effect.suspend(() =>
      enforce(input.sessionId, input.method, gateNeedFor(input.method, input.payload)).pipe(
        Effect.andThen(admit(input.sessionId, input.method, input.payload)),
        Effect.andThen(passShield(input.sessionId, input.method, input.payload)),
        Effect.andThen(passPlan(input.sessionId, input.method, input.payload)),
      ),
    );

  const checkHttp: SkycotFamilyGate["Service"]["checkHttp"] = (input) =>
    Effect.suspend(() =>
      enforce(
        input.sessionId,
        `${input.method} ${input.pathname}`,
        gateNeedForHttp(input.method, input.pathname, input.payload),
      ),
    );

  return SkycotFamilyGate.of({ check, checkHttp, requestNeedsGrownUp });
});

/** The gate alone; the Family limits apply when `SkycotFamilyLimits` is provided beside it. */
export const layerCore = Layer.effect(SkycotFamilyGate, make);

/** The gate with the engine's limits under it (both are exported: the HTTP routes use the limits too). */
export const layer = layerCore.pipe(Layer.provideMerge(SkycotFamilyLimits.layer));

/**
 * The scope middleware with the Family check in front of it, for ws.ts. Provided inside the
 * scope middleware's own `Effect.provide`, so it wraps that instance; the check runs before
 * the scope check's `onAuthorized` hook so a refused call records nothing.
 */
export const layerRpcAuthorization = (gate: SkycotFamilyGate["Service"], sessionId: string) =>
  Layer.effect(
    RpcScopeAuthorization,
    Effect.gen(function* () {
      const authorize = yield* RpcScopeAuthorization;
      return RpcScopeAuthorization.of((effect, options) =>
        gate
          .check({ sessionId, method: options.rpc._tag, payload: options.payload })
          .pipe(Effect.andThen(Effect.suspend(() => authorize(effect, options)))),
      );
    }),
  );
