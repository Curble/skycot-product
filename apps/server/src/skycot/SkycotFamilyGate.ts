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
// Reading files stays open inside SKYCOT's projects and their conversations' private copies,
// and nowhere else: the stock file RPCs (`projects.readFile` with a full path, listings and
// searches of any folder, `assets.createUrl` for a picture anywhere on the Mac) and hidden or
// secret files (`.env`, `.git`, keys) need a grown-up's `files` yes. The plain client's own
// Files routes apply the same rule, and also hold add-ons and build output (skycot/files).
//
// Who is who (Phase 1): every call is first judged by who the device is (family-devices/
// SkycotFamilyIdentity). A removed device is refused everything. A grown-up's device may only
// read (T3 gives it the read scope alone; this checks it again, so a wrong grant cannot widen
// it) and answers requests through SKYCOT's own approver routes. A child's own device may only
// name its own conversations, projects and folders (family-devices/SkycotFamilyVisibility), and
// cross-conversation searches are closed to it; its shell lists arrive filtered.
//
// Just ask, one space per child: "open Questions" (`projects.ensureScratch`) is answered with the
// Questions space of the child using SKYCOT on that session (questions/SkycotQuestionSpaces), and
// a child's own device may start a new question only in their own space: a brother's or
// sister's is theirs, and the shared space (questions from before) is the grown-ups'.
//
// Agents reach the same capabilities through T3's MCP tools, which this gate does not see;
// those are closed separately: while the profile is on, ProviderSessionManager issues a thread no
// MCP credential at all (seam skycot-family-mcp), so the agent is given no engine tool server and
// none of its tools (thread control, worktrees, pull requests, devices, page previews, and
// html_render / html_preview, which may first download a browser) is listed or callable.

import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  OrchestrationDispatchCommandError,
  ORCHESTRATION_V2_WS_METHODS,
  RpcScopeAuthorization,
  WS_METHODS,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type PlanId,
  type ProjectId,
  type ProviderDriverKind,
  type RuntimeRequestId,
  type ThreadId,
  authScopeRequiredResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { cleanBrowsePath, pathIsHiddenOrSecret } from "@t3tools/skycot-rules/browse";
import {
  deleteConversationApprovalId,
  describeFamilyMatches,
  evaluateFamilyRequest,
  projectApprovalCoverFor,
  type FamilyEvaluation,
  type ProjectApprovalCover,
} from "@t3tools/skycot-rules/family";
import { childMayStartInProject } from "@t3tools/skycot-rules/people";
import { describeMatches } from "@t3tools/skycot-rules/rules";
import { isLocalPreviewAddress } from "@t3tools/skycot-rules/preview";
import {
  childMayStartQuestionIn,
  isInQuestionsSpace,
  isQuestionsSpace,
  questionsSpaceOf,
  workRootsFor,
} from "@t3tools/skycot-rules/questions";
import {
  findPersonalDetails,
  personalCategories,
  shieldApprovalId,
} from "@t3tools/skycot-rules/personal";

import { AuthOrchestrationReadScope } from "@t3tools/contracts";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyIdentity from "./family-devices/SkycotFamilyIdentity.ts";
import * as SkycotFamilyVisibility from "./family-devices/SkycotFamilyVisibility.ts";
import { filterArchivedSnapshot } from "./family-devices/visibility.ts";
import { isInsideRoot } from "./files/SkycotFiles.ts";
import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyExtras from "./SkycotFamilyExtras.ts";
import * as SkycotFamilyInstructions from "./SkycotFamilyInstructions.ts";
import { requestFacts } from "./SkycotPolicy.ts";
import * as SkycotQuestions from "./questions/SkycotQuestions.ts";
import * as SkycotQuestionSpaces from "./questions/SkycotQuestionSpaces.ts";

/** `requiredPermission` on the refusal, so a client can tell "ask a grown-up" from a scope error. */
export const FAMILY_PERMISSION = "skycot:family-parent-code";

/** `requiredPermission` when SKYCOT is asleep for the child: the client shows its asleep screen. */
export const FAMILY_ASLEEP_PERMISSION = "skycot:family-asleep";

// nondev-seam: skycot-child-gate-copy
export const FAMILY_REFUSAL_MESSAGE = "A grown-up needs to say yes first.";

/** `requiredPermission` when a device may not do this at all (whose it is decides, not a code). */
export const FAMILY_DEVICE_PERMISSION = "skycot:family-device";

export const REMOVED_DEVICE_MESSAGE =
  "This device was removed from the Family profile. Link it again from the family's Mac.";
export const GROWN_UP_DEVICE_MESSAGE =
  "A grown-up's device can read and say yes or no, but not change anything.";
export const CHILD_DEVICE_MESSAGE = "That's not yours to open.";

/**
 * Calls a child's own device may not make at all: searches across every conversation (they would
 * list a brother's or sister's), and the parent's other AI sessions on this Mac.
 */
export const CHILD_DEVICE_CLOSED_METHODS: ReadonlySet<string> = new Set([
  ORCHESTRATION_V2_WS_METHODS.searchThreads,
  ORCHESTRATION_V2_WS_METHODS.searchThreadStream,
  "agentSessions.scan",
  "agentSessions.import",
  "server.listAcpRegistrySessions",
  // The discovery response includes the parent's authenticated GitHub account names.
  WS_METHODS.serverDiscoverSourceControl,
  "pullRequests.linkedThreads",
]);

/**
 * Grown-up details a chosen child must not read, on their own device or on the shared Mac (until
 * a grown-up's code opens grown-up mode): automations, webhook logs, and source-control identity.
 */
// nondev-seam: skycot-q57-hide-source-control-identity
export const CHILD_VIEW_CLOSED_METHODS: ReadonlySet<string> = new Set([
  WS_METHODS.scheduledTasksList,
  WS_METHODS.scheduledTasksSubscribe,
  WS_METHODS.scheduledTasksListWebhookDeliveries,
  WS_METHODS.scheduledTasksGetWebhookDelivery,
  WS_METHODS.serverDiscoverSourceControl,
]);

/** Calls that only read a file, where a page pinned to the fridge stays open to every child. */
const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  "projects.readFile",
  "projects.listEntries",
  "projects.listIgnoredFiles",
  "projects.searchEntries",
  "projects.searchContents",
  "assets.createUrl",
  "filesystem.getMetadata",
]);

/** Whether a grown-up's device may make this call: only what T3's read scope covers. */
export function grownUpDeviceMayCall(method: string): boolean {
  try {
    return requiredScopeForRpcMethod(method) === AuthOrchestrationReadScope;
  } catch {
    return false;
  }
}

export const deviceRefusal = (message: string) =>
  new EnvironmentAuthorizationError({
    message,
    ...authScopeResponseFor(),
    requiredPermission: FAMILY_DEVICE_PERMISSION,
  });

function authScopeResponseFor() {
  return authScopeRequiredResponse(AuthOrchestrationOperateScope);
}

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
  /**
   * Reading: open inside a SKYCOT project or a conversation's private copy, for a path that
   * stays inside it and is not a hidden or secret file; anything else is a grown-up's `files` yes.
   */
  | { readonly type: "readInProject"; readonly cwd: string; readonly path?: string }
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
/** Listings and searches of a folder (`cwd`): open inside SKYCOT's projects only. */
const READ_FOLDER_METHODS = new Set([
  "projects.listEntries",
  "projects.listIgnoredFiles",
  "projects.searchEntries",
  "projects.searchContents",
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
    // nondev-seam: skycot-grown-up-session-approval
    // Deleting a conversation cannot be undone (putting it away can), so the grown-up approves
    // this exact conversation; the session never grants a general delete permission.
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
  if (method === "projects.readFile") {
    return typeof input["cwd"] === "string"
      ? {
          type: "readInProject",
          cwd: input["cwd"],
          path: typeof input["relativePath"] === "string" ? input["relativePath"] : "",
        }
      : { type: "grant", purpose: "files" };
  }
  if (READ_FOLDER_METHODS.has(method)) {
    if (typeof input["cwd"] !== "string") return { type: "grant", purpose: "files" };
    return typeof input["directoryPath"] === "string" && input["directoryPath"].length > 0
      ? { type: "readInProject", cwd: input["cwd"], path: input["directoryPath"] }
      : { type: "readInProject", cwd: input["cwd"] };
  }
  if (method === "assets.createUrl") {
    const resource = record(input["resource"]);
    // A picture anywhere on the Mac by its full path.
    if (resource["_tag"] === "media-file") return { type: "grant", purpose: "files" };
    if (resource["_tag"] === "draft-workspace-file") {
      return typeof resource["cwd"] === "string" && typeof resource["path"] === "string"
        ? { type: "readInProject", cwd: resource["cwd"], path: resource["path"] }
        : { type: "grant", purpose: "files" };
    }
    return null;
  }
  if (method === "shell.openInEditor") {
    // Show in Finder for a file of the project is the Files view's grown-up button; opening
    // a code editor, or Finder anywhere else, stays with the developer tools.
    if (input["editor"] === "file-manager" && input["reveal"] === true) {
      return typeof input["cwd"] === "string"
        ? { type: "grant", purpose: "files" }
        : { type: "grant", purpose: "advanced" };
    }
    return { type: "grant", purpose: "advanced" };
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

/**
 * Pure: the project a call starts a new conversation in, if it starts one (a launch that is not
 * a reuse of an existing conversation, or `thread.create`). Exported for tests.
 */
export function newThreadProject(method: string, payload: unknown): string | null {
  const input = record(payload);
  const projectId = typeof input["projectId"] === "string" ? input["projectId"] : null;
  if (method === ORCHESTRATION_V2_WS_METHODS.launchThread) {
    return input["reuseExistingThread"] === true ? null : projectId;
  }
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand && input["type"] === "thread.create") {
    return projectId;
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

/** Pure: the plan a Build it names, if the call is one. */
export function sourcePlanOf(
  payload: unknown,
): { readonly threadId: string; readonly planId: string } | null {
  const ref = record(record(payload)["sourcePlanRef"]);
  return typeof ref["threadId"] === "string" && typeof ref["planId"] === "string"
    ? { threadId: ref["threadId"], planId: ref["planId"] }
    : null;
}

/**
 * Pure: whether a Build it may run without a fresh plan. The plan must still be waiting, and
 * its turn must still be part of the conversation: going back to an earlier message (or Undo)
 * takes that turn back, the assistant forgets the plan, but the engine leaves the plan
 * "active". Building it then would make changes from a plan the assistant no longer has, so
 * such a message plans again, like any other.
 */
export function planStillBuildable(
  projection: Pick<OrchestrationV2ThreadProjection, "plans" | "runs">,
  planId: string,
): boolean {
  const plan = projection.plans.find((candidate) => candidate.id === planId);
  if (plan === undefined || plan.kind !== "proposed_plan" || plan.status !== "active") return false;
  if (plan.runId === null) return true;
  const run = projection.runs.find((candidate) => candidate.id === plan.runId);
  return run !== undefined && run.status !== "rolled_back";
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
      /** The session's sign-in subject, when the caller holds it: says which device this is. */
      readonly subject?: string | undefined;
      readonly method: string;
      readonly payload: unknown;
    }) => Effect.Effect<void, EnvironmentAuthorizationError>;
    /** A call's answer as this session may see it (a child's device gets its own work only). */
    readonly filterResult: (input: {
      readonly sessionId: string;
      readonly method: string;
      readonly result: unknown;
    }) => Effect.Effect<unknown>;
    /**
     * What a pending request is, in plain words, and whether only a grown-up may allow it, for a
     * grown-up's phone. Null when it is not a pending approval the gate can read.
     */
    readonly describeRequest: (input: {
      readonly threadId: ThreadId;
      readonly requestId: RuntimeRequestId;
    }) => Effect.Effect<RequestDescription | null>;
    /**
     * Hands a call the visibility service this gate was built with, so the shell streams it
     * returns can filter themselves (ws.ts seam skycot-family-visibility). RPC handlers only see
     * the server's top-level services, so the gate carries it in, as it carries the check.
     */
    readonly withVisibility: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
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
    /**
     * "Open Questions" for this session: the Questions space of the child using SKYCOT here (made
     * on first use). None leaves the answer to T3 (its Scratch project): the profile is off,
     * nobody is picked on the Mac, or the engine was built without spaces (older tests, tools).
     */
    readonly questionsSpaceFor: (
      sessionId: string,
    ) => Effect.Effect<
      Option.Option<{ readonly projectId: ProjectId }>,
      EnvironmentAuthorizationError | OrchestrationDispatchCommandError
    >;
    /**
     * Where a child's new project goes: a `projects` folder inside their own space, with the
     * child it is for; none for a grown-up or a Mac with no child chosen.
     */
    readonly childProjectHome: (
      sessionId: string,
    ) => Effect.Effect<
      Option.Option<{ readonly parentRoot: string; readonly childId: string }>,
      EnvironmentAuthorizationError | OrchestrationDispatchCommandError
    >;
    /** Records a project the window's child just made as theirs (best effort). */
    readonly recordChildProject: (input: {
      readonly sessionId: string;
      readonly projectId: ProjectId;
    }) => Effect.Effect<void>;
  }
>()("t3/skycot/SkycotFamilyGate") {}

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;

/** A pending request as a grown-up's phone shows it. */
// nondev-seam: skycot-project-approval-description
export interface RequestDescription {
  readonly needsGrownUp: boolean;
  /** "It uses the internet." */
  readonly why: string | null;
  /** What it wants to do: the command, or the files, as the assistant asked. */
  readonly what: string;
  readonly kind: ApprovalItem["requestKind"];
  /** A second answer scope is available only for these closed, project-safe request kinds. */
  readonly projectCovers?: ReadonlyArray<ProjectApprovalCover>;
}

const make = Effect.gen(function* () {
  const family = yield* SkycotFamily.SkycotFamily;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  // Optional so a gate built without the limits (older tests, tools) keeps its old behaviour.
  const limits = yield* Effect.serviceOption(SkycotFamilyLimits.SkycotFamilyLimits);
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;
  // Optional: without them (older tests, tools) every session is the family's Mac, as before.
  const identities = yield* Effect.serviceOption(SkycotFamilyIdentity.SkycotFamilyIdentity);
  const visibility = yield* Effect.serviceOption(SkycotFamilyVisibility.SkycotFamilyVisibility);
  // Optional: without it (older tests, tools) "open Questions" stays T3's own shared space.
  const questionSpaces = yield* Effect.serviceOption(SkycotQuestionSpaces.SkycotQuestionSpaces);
  // The same extra facts the policy reactor reads (trusted add-ons, repeats, undoable deletes).
  const familyExtras = yield* SkycotFamilyExtras.make;

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
    const roots = workRootsFor({ projectFolder, worktreePath: thread.worktreePath, questionsRoot });
    const real = (value: string | null) =>
      value === null
        ? Effect.succeed(null)
        : fs.realPath(value).pipe(Effect.orElseSucceed(() => value));
    return {
      projectRoot: yield* real(roots.projectRoot),
      projectFolder: yield* real(roots.projectFolder),
    };
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
      {
        ...(yield* projectRootsFor(thread)),
        ...(yield* familyExtras({ threadId: input.threadId, driver })),
      },
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

  const describeRequest: SkycotFamilyGate["Service"]["describeRequest"] = Effect.fn(
    "SkycotFamilyGate.describeRequest",
  )(
    function* (input) {
      const thread = yield* projections.getThread(input.threadId);
      const approval = yield* projections.getTurnItem({
        threadId: input.threadId,
        itemId: IdAllocator.derive.approvalTurnItem({ requestId: input.requestId }),
      });
      if (approval === null || approval.type !== "approval_request") return null;
      const driver = approval.nativeItemRef?.driver;
      const toolCall = yield* toolCallFor(input.threadId, approval, driver);
      const facts = requestFacts(approval, toolCall, driver);
      const what =
        facts?.kind === "command" && facts.command
          ? facts.command
          : facts !== null && "files" in facts && facts.files && facts.files.length > 0
            ? facts.files.map((file) => file.path).join(", ")
            : (approval.prompt ?? approval.title ?? "");
      if (facts === null) {
        return { needsGrownUp: true, why: null, what, kind: approval.requestKind };
      }
      const roots = yield* projectRootsFor(thread);
      const evaluation = evaluateFamilyRequest(
        { ...facts, toolItemType: toolCall?.type },
        {
          ...roots,
          ...(yield* familyExtras({ threadId: input.threadId, driver })),
        },
      );
      const parts = [
        describeFamilyMatches(evaluation.family),
        describeMatches(evaluation.base.matches),
      ].filter((part) => part.length > 0);
      const projectCover = projectApprovalCoverFor(
        { ...facts, toolItemType: toolCall?.type },
        evaluation,
        roots,
      );
      return {
        needsGrownUp: evaluation.needsGrownUp,
        why: parts.length > 0 ? `It ${parts.join(", and ")}.` : null,
        what: what.slice(0, 400),
        kind: approval.requestKind,
        ...(projectCover === null ? {} : { projectCovers: [projectCover] }),
      } satisfies RequestDescription;
    },
    Effect.orElseSucceed(() => null),
  );

  // A question's own folder is SKYCOT's space, not the person's: open like a project's.
  const isProjectFolder = (cwd: string) =>
    isInQuestionsSpace(cwd, questionsRoot)
      ? Effect.succeed(true)
      : projects.findActiveByWorkspaceRoot(cwd.replace(/[/\\]+$/, "")).pipe(
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => false),
        );

  // A question made into a project (Undo takes it off the list again); never a whole space.
  const isQuestionProject = (projectId: ProjectId) =>
    projects.get(projectId).pipe(
      Effect.map(
        (project) =>
          Option.isSome(project) &&
          isInQuestionsSpace(project.value.workspaceRoot, questionsRoot) &&
          !isQuestionsSpace(project.value.workspaceRoot, questionsRoot),
      ),
      Effect.orElseSucceed(() => false),
    );

  /**
   * Whether a child may start a new conversation in this project: anywhere the other rules
   * allow, except a Questions space that is not their own (a sibling's, or the shared one).
   * A project the gate cannot read is no space, and the visibility rules judge it as before.
   */
  const childMayStartIn = Effect.fnUntraced(function* (childId: string, projectId: string) {
    const project = yield* projects
      .get(projectId as ProjectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return true;
    const space = questionsSpaceOf(project.value.workspaceRoot, questionsRoot);
    return space === null || childMayStartQuestionIn(childId, space);
  });

  const isKnownProject = (projectId: ProjectId) =>
    projects.get(projectId).pipe(
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
    );

  const realOr = (folder: string) =>
    fs.realPath(folder).pipe(Effect.orElseSucceed(() => path.resolve(folder)));

  /**
   * Whether a folder is a SKYCOT project's, a conversation's private copy, or inside one,
   * judged by real paths so a symlinked folder counts as where it really is.
   */
  const isKnownFolder = Effect.fnUntraced(function* (cwd: string) {
    const real = yield* realOr(cwd);
    const roots = [
      ...(yield* projects.list().pipe(Effect.orElseSucceed(() => []))).map(
        (project) => project.workspaceRoot,
      ),
      ...(yield* projections
        .getThreadWorktreePaths({ includeArchived: true })
        .pipe(Effect.orElseSucceed(() => []))).map((entry) => entry.worktreePath),
    ];
    for (const root of roots) {
      if (isInsideRoot(yield* realOr(root), real, path.sep)) return true;
    }
    return false;
  });

  /** A read inside a known folder, of a path that stays in it and is not hidden or secret. */
  const isOpenRead = Effect.fnUntraced(function* (need: { cwd: string; path?: string }) {
    if (need.path !== undefined) {
      const cleaned = cleanBrowsePath(need.path);
      if (cleaned === null || pathIsHiddenOrSecret(cleaned)) return false;
    }
    return yield* isKnownFolder(need.cwd);
  });

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
    if (need.type === "readInProject") {
      if (yield* isOpenRead(need)) return;
      if (yield* family.allows({ sessionId, purpose: "files" })) return;
      yield* Effect.logInfo("skycot-family.refused", { method, purpose: "files" });
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
    const projectScope =
      need.widens || need.requestId === undefined
        ? { scope: "once" as const, how: "parent-code" as const }
        : yield* family.approvalScope({ sessionId, requestId: need.requestId });
    const allowed = yield* family.allows({
      sessionId,
      purpose: "approve",
      requestId: need.requestId,
      consume: true,
    });
    if (allowed) {
      if (
        projectScope.scope === "project" &&
        need.requestId !== undefined &&
        Option.isSome(limits)
      ) {
        yield* Effect.gen(function* () {
          const step = yield* limits.value.stepRuleFor({ threadId: need.threadId });
          const described = yield* describeRequest({
            threadId: need.threadId,
            requestId: need.requestId,
          });
          const thread = yield* projections.getThread(need.threadId);
          const project = yield* projects.get(thread.projectId);
          if (step.type === "auto" && described?.projectCovers?.length && Option.isSome(project)) {
            const projectPath = yield* fs
              .realPath(project.value.workspaceRoot)
              .pipe(Effect.orElseSucceed(() => ""));
            if (projectPath.length > 0) {
              yield* family.grantProjectApproval({
                childId: step.childId,
                projectPath,
                covers: described.projectCovers,
                grantedBy: "grown-up",
                how: projectScope.how,
              });
            }
          }
        }).pipe(Effect.catchCause(() => Effect.void));
      }
      if (Option.isSome(limits)) {
        yield* limits.value.recordEvent({
          sessionId,
          kind: "approved",
          threadId: need.threadId,
          // So the child's card can say "A grown-up said yes" (grownUpAnswers.ts).
          ...(need.requestId === undefined ? {} : { requestId: need.requestId }),
        });
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
    const source = buildsPlan(method, payload) ? sourcePlanOf(payload) : null;
    const buildable =
      source !== null &&
      (yield* projections.getThreadProjection(source.threadId as ThreadId).pipe(
        Effect.map((projection) => planStillBuildable(projection, source.planId as PlanId)),
        // A plan the gate cannot read is not one it can vouch for: it plans (the safe side).
        Effect.orElseSucceed(() => false),
      ));
    if (source !== null && !buildable) {
      yield* Effect.logInfo("skycot-family.plan-first", { buildIt: "plan-not-waiting" });
    }
    if (buildable) {
      yield* SkycotFamilyInstructions.letRunWithoutPlan(message.messageId, "builds-plan");
    } else if (yield* family.allows({ sessionId, purpose: "advanced" })) {
      yield* SkycotFamilyInstructions.letRunWithoutPlan(message.messageId, "grown-up");
    } else if (
      source === null &&
      message.threadId !== undefined &&
      SkycotFamilyInstructions.isSmallTweak(message.text)
    ) {
      // A small change to something this conversation already built: no plan card for it.
      const builtBefore = yield* projections.getThreadProjection(message.threadId as ThreadId).pipe(
        Effect.map((projection) => projection.plans.some((plan) => plan.runId !== null)),
        // Anything that cannot be read plans (the safe side), a missing store included.
        Effect.catchCause(() => Effect.succeed(false)),
      );
      if (builtBefore) {
        yield* SkycotFamilyInstructions.letRunWithoutPlan(message.messageId, "small-follow-up");
      }
    }
  });

  /** Who the device is decides first: a removed one gets nothing, a grown-up's only reads. */
  const judgeDevice = Effect.fn("SkycotFamilyGate.judgeDevice")(function* (input: {
    readonly sessionId: string;
    readonly subject?: string | undefined;
    readonly method: string;
    readonly payload: unknown;
  }) {
    if (Option.isNone(identities)) return;
    const who =
      input.subject === undefined
        ? yield* identities.value.identify(input.sessionId)
        : yield* identities.value.identifySession({
            sessionId: input.sessionId,
            subject: input.subject,
          });
    if (who.kind === "removed") {
      yield* Effect.logInfo("skycot-family.device-refused", {
        method: input.method,
        why: "removed",
      });
      return yield* deviceRefusal(REMOVED_DEVICE_MESSAGE);
    }
    if (who.kind === "grown-up") {
      if (grownUpDeviceMayCall(input.method)) return;
      yield* Effect.logInfo("skycot-family.device-refused", {
        method: input.method,
        why: "grown-up",
      });
      return yield* deviceRefusal(GROWN_UP_DEVICE_MESSAGE);
    }
    if (who.kind === "child" && CHILD_DEVICE_CLOSED_METHODS.has(input.method)) {
      yield* Effect.logInfo("skycot-family.device-refused", { method: input.method, why: "child" });
      return yield* deviceRefusal(CHILD_DEVICE_MESSAGE);
    }
    if (Option.isNone(visibility)) {
      // No way to filter what a child's device would receive: the lists stay closed to it.
      if (who.kind === "child") return yield* deviceRefusal(CHILD_DEVICE_MESSAGE);
      return;
    }
    const view = yield* visibility.value.childViewFor(input.sessionId);
    if (view === null) return;
    if (CHILD_VIEW_CLOSED_METHODS.has(input.method)) {
      yield* Effect.logInfo("skycot-family.device-refused", {
        method: input.method,
        why: "child-view",
      });
      return yield* deviceRefusal(CHILD_DEVICE_MESSAGE);
    }
    const allowed = yield* visibility.value.allows(
      view,
      SkycotFamilyVisibility.referencedBy(input.payload),
      READ_ONLY_METHODS.has(input.method) ? "read" : "use",
    );
    const startsIn = newThreadProject(input.method, input.payload);
    // Seeing is not starting: new work begins only in the child's own or an unowned project, on
    // every session kind, even where they may open a conversation of their own.
    const theirsToStart =
      startsIn === null || childMayStartInProject(view.childId, startsIn, view.owners);
    if (
      allowed &&
      theirsToStart &&
      (startsIn === null || (yield* childMayStartIn(view.childId, startsIn)))
    ) {
      return;
    }
    yield* Effect.logInfo("skycot-family.device-refused", {
      method: input.method,
      why: !allowed ? "not-theirs" : !theirsToStart ? "not-their-project" : "not-their-questions",
    });
    return yield* deviceRefusal(CHILD_DEVICE_MESSAGE);
  });

  const questionsSpaceFor: SkycotFamilyGate["Service"]["questionsSpaceFor"] = Effect.fn(
    "SkycotFamilyGate.questionsSpaceFor",
  )(function* (sessionId) {
    if (Option.isNone(questionSpaces) || Option.isNone(limits)) return Option.none();
    if (!(yield* family.isEnabled)) return Option.none();
    const session = yield* limits.value.forSession({ sessionId });
    if (session.childId === null) {
      // A child's own device always has its child; one without is refused, never handed the
      // shared space.
      if (session.device === "child") return yield* deviceRefusal(CHILD_DEVICE_MESSAGE);
      return Option.none();
    }
    const childId = session.childId;
    const status = yield* family.status.pipe(Effect.orElseSucceed(() => null));
    const childName = status?.children.find((child) => child.id === childId)?.name ?? null;
    return yield* questionSpaces.value.ensureChildSpace({ childId, childName }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("skycot-questions.space-failed", { reason: cause.message }),
      ),
      Effect.mapError(
        (cause) => new OrchestrationDispatchCommandError({ message: cause.message, cause }),
      ),
    );
  });

  const childProjectHome: SkycotFamilyGate["Service"]["childProjectHome"] = Effect.fn(
    "SkycotFamilyGate.childProjectHome",
  )(function* (sessionId) {
    const space = yield* questionsSpaceFor(sessionId);
    if (Option.isNone(space) || Option.isNone(limits)) {
      yield* Effect.logInfo("skycot-child-projects.no-space", {
        sessionId,
        hasSpace: Option.isSome(space),
        hasLimits: Option.isSome(limits),
      });
      return Option.none();
    }
    const session = yield* limits.value.forSession({ sessionId });
    if (session.childId === null) return Option.none();
    const project = yield* projects
      .get(space.value.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return Option.none();
    return Option.some({
      parentRoot: path.join(project.value.workspaceRoot, "projects"),
      childId: session.childId,
    });
  });

  const recordChildProject: SkycotFamilyGate["Service"]["recordChildProject"] = Effect.fn(
    "SkycotFamilyGate.recordChildProject",
  )(function* (input) {
    if (Option.isNone(limits)) return;
    yield* limits.value
      .recordStart({ sessionId: input.sessionId, projectId: input.projectId })
      .pipe(Effect.ignore);
  });

  const check: SkycotFamilyGate["Service"]["check"] = (input) =>
    Effect.suspend(() =>
      judgeDevice(input).pipe(
        Effect.andThen(
          enforce(input.sessionId, input.method, gateNeedFor(input.method, input.payload)),
        ),
        Effect.andThen(admit(input.sessionId, input.method, input.payload)),
        Effect.andThen(passShield(input.sessionId, input.method, input.payload)),
        Effect.andThen(passPlan(input.sessionId, input.method, input.payload)),
      ),
    );

  const filterResult: SkycotFamilyGate["Service"]["filterResult"] = Effect.fn(
    "SkycotFamilyGate.filterResult",
  )(function* (input) {
    if (input.method !== ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot) return input.result;
    if (Option.isNone(visibility)) return input.result;
    const view = yield* visibility.value.childViewFor(input.sessionId);
    if (view === null) return input.result;
    return filterArchivedSnapshot(view, input.result as never);
  });

  const checkHttp: SkycotFamilyGate["Service"]["checkHttp"] = (input) =>
    Effect.suspend(() =>
      enforce(
        input.sessionId,
        `${input.method} ${input.pathname}`,
        gateNeedForHttp(input.method, input.pathname, input.payload),
      ),
    );

  const withVisibility: SkycotFamilyGate["Service"]["withVisibility"] = (effect) =>
    Option.isSome(visibility)
      ? Effect.provideService(
          effect,
          SkycotFamilyVisibility.SkycotFamilyVisibility,
          visibility.value,
        )
      : effect;

  return SkycotFamilyGate.of({
    check,
    checkHttp,
    requestNeedsGrownUp,
    filterResult,
    describeRequest,
    withVisibility,
    questionsSpaceFor,
    childProjectHome,
    recordChildProject,
  });
});

/** The gate alone; the Family limits apply when `SkycotFamilyLimits` is provided beside it. */
export const layerCore = Layer.effect(SkycotFamilyGate, make);

/**
 * The gate with the engine's limits, who-is-who, per-person visibility and the children's
 * Questions spaces under it (all are exported: the HTTP routes use them too).
 */
export const layer = layerCore.pipe(
  Layer.provideMerge(SkycotQuestionSpaces.layer),
  Layer.provideMerge(SkycotFamilyVisibility.layer),
  Layer.provideMerge(SkycotFamilyLimits.layer),
  Layer.provideMerge(SkycotFamilyIdentity.layer),
);

/**
 * "Open Questions" (`projects.ensureScratch`, whose answer is `{ projectId }`): the space of the
 * child using SKYCOT on this session, else T3's own answer (its Scratch project). Its refusals
 * are the ones that call already has: the device's, or "couldn't open" (a dispatch error).
 */
const questionsSpaceFirst = <A, E, R>(
  gate: SkycotFamilyGate["Service"],
  sessionId: string,
  upstream: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
  gate
    .questionsSpaceFor(sessionId)
    .pipe(
      Effect.flatMap((space) =>
        Option.isSome(space) ? Effect.succeed(space.value as A) : upstream,
      ),
    ) as Effect.Effect<A, E, R>;

/**
 * The scope middleware with the Family check in front of it, for ws.ts. Provided inside the
 * scope middleware's own `Effect.provide`, so it wraps that instance; the check runs before
 * the scope check's `onAuthorized` hook so a refused call records nothing.
 */
export const layerRpcAuthorization = (
  gate: SkycotFamilyGate["Service"],
  sessionId: string,
  /** The session's sign-in subject: which linked device this is (optional for older callers). */
  subject?: string,
) =>
  Layer.effect(
    RpcScopeAuthorization,
    Effect.gen(function* () {
      const authorize = yield* RpcScopeAuthorization;
      return RpcScopeAuthorization.of((effect, options) =>
        gate
          .check({ sessionId, subject, method: options.rpc._tag, payload: options.payload })
          .pipe(
            Effect.andThen(
              Effect.suspend(() =>
                authorize(
                  gate.withVisibility(
                    options.rpc._tag === ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot
                      ? (Effect.flatMap(effect, (result) =>
                          gate.filterResult({ sessionId, method: options.rpc._tag, result }),
                        ) as typeof effect)
                      : options.rpc._tag === WS_METHODS.projectsEnsureScratch
                        ? questionsSpaceFirst(gate, sessionId, effect)
                        : effect,
                  ),
                  options,
                ),
              ),
            ),
          ),
      );
    }),
  );
