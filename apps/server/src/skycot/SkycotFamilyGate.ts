// While the Family profile is on, the RPCs that publish, schedule, install, open the developer
// tools, or allow a risky step need a grown-up: a grant the parent code opened for this
// session (SkycotFamily.verify). Checked in the WebSocket RPC middleware, beside the scope
// check, so a raw RPC from any client (the plain client, Advanced mode, a script with the
// session cookie) meets the same rule as a click.
//
// Agents reach the same capabilities through T3's MCP tools, which this gate does not see;
// those are closed separately by issuing Family-profile threads an MCP credential without the
// orchestration, worktree and pull-request capabilities (`SkycotFamily.keepFamilyMcpCapabilities`).

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
import { evaluateFamilyRequest, type FamilyEvaluation } from "@t3tools/skycot-rules/family";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import { requestFacts } from "./SkycotPolicy.ts";

/** `requiredPermission` on the refusal, so a client can tell "ask a grown-up" from a scope error. */
export const FAMILY_PERMISSION = "skycot:family-parent-code";

export const FAMILY_REFUSAL_MESSAGE =
  "The Family profile is on, so a grown-up needs to enter the parent code first.";

type Purpose = SkycotFamily.FamilyPurpose;

/** What a gated call needs, or null when it is open to the child. */
export type GateNeed =
  | { readonly type: "grant"; readonly purpose: Purpose }
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
/** Setting up the AI assistants: the parent's accounts, tools and launch options. */
const SETTINGS_METHODS = new Set([
  "provider.install.start",
  "provider.install.remove",
  "server.updateProvider",
]);
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
  "server.signalProcess",
  "cloud.installRelayClient",
  "shell.openInEditor",
  "device.configure",
  "device.testHost",
  "agentSessions.import",
]);

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

/** Pure: which grown-up check a call needs. Exported for tests. */
export function gateNeedFor(method: string, payload: unknown): GateNeed | null {
  const input = record(payload);
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand) {
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
    // Renaming stays open; adding a folder, moving a project's folder or removing it does not.
    if (input["type"] === "project.update" && input["workspaceRoot"] === undefined) return null;
    return { type: "grant", purpose: "openFolder" };
  }
  if (method === "projects.add" || method === "projects.remove") {
    return { type: "grant", purpose: "openFolder" };
  }
  if (method === "server.updateSettings") {
    return isChildSafeSettingsPatch(payload) ? null : { type: "grant", purpose: "settings" };
  }
  if (SETTINGS_METHODS.has(method)) return { type: "grant", purpose: "settings" };
  if (ADVANCED_METHODS.has(method)) return { type: "grant", purpose: "advanced" };
  return null;
}

export const familyRefusal = () =>
  new EnvironmentAuthorizationError({
    message: FAMILY_REFUSAL_MESSAGE,
    ...authScopeRequiredResponse(AuthOrchestrationOperateScope),
    requiredPermission: FAMILY_PERMISSION,
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

  const projectRootFor = Effect.fnUntraced(function* (thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  }) {
    if (thread.worktreePath !== null) return thread.worktreePath;
    const project = yield* projects.get(thread.projectId);
    return Option.isSome(project) ? project.value.workspaceRoot : null;
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
    const projectRoot = yield* projectRootFor(thread);
    return evaluateFamilyRequest(
      { ...facts, toolItemType: toolCall?.type },
      { projectRoot },
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

  const check: SkycotFamilyGate["Service"]["check"] = Effect.fn("SkycotFamilyGate.check")(
    function* (input) {
      const need = gateNeedFor(input.method, input.payload);
      if (need === null) return;
      if (!(yield* family.isEnabled)) return;
      if (need.type === "grant") {
        if (yield* family.allows({ sessionId: input.sessionId, purpose: need.purpose })) return;
        yield* Effect.logInfo("skycot-family.refused", {
          method: input.method,
          purpose: need.purpose,
        });
        return yield* familyRefusal();
      }
      const grownUp =
        need.widens ||
        (yield* requestNeedsGrownUp({ threadId: need.threadId, requestId: need.requestId }));
      if (!grownUp) return;
      const allowed = yield* family.allows({
        sessionId: input.sessionId,
        purpose: "approve",
        requestId: need.requestId,
        consume: true,
      });
      if (allowed) return;
      yield* Effect.logInfo("skycot-family.refused", {
        method: input.method,
        requestId: need.requestId,
      });
      return yield* familyRefusal();
    },
  );

  return SkycotFamilyGate.of({ check, requestNeedsGrownUp });
});

export const layer = Layer.effect(SkycotFamilyGate, make);

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
