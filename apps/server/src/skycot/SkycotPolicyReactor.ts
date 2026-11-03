// nondev-seam: skycot-policy-reactor-network-guard
// Answers the provider's approval requests for threads the SKYCOT policy governs: approves
// what no hard rule matches, leaves the rest pending for the person. See SkycotPolicy.ts for
// the design and the flag that gates both halves.
//
// With the Family profile on, every conversation is governed (the provider asks before every
// step, SkycotPolicy.familyRuntimePolicy), and a step is approved here only when BOTH the hard
// rules and the Family rules clear it (`evaluateFamilyRequest`: `needsGrownUp` false), or Codex's
// offline sandbox contains an internet/opaque-code-only hold; and the child it belongs to may
// have safe steps run by themselves (SkycotFamilyLimits.stepRuleFor:
// their parent has not switched on "Ask before each step", and SKYCOT is awake for them).
// First principles: a child cannot meaningfully judge "May I list these files?", so a card per
// step adds fatigue, not safety; the safeguards are the engine's rules, the grown-up gate and
// restore points. Other held steps stay pending for a grown-up (the parent code, a grown-up's
// phone or Watch); the offline sandbox cannot contain them.
//
// It also closes the door Stop leaves open: the engine only cancels a run's pending asks
// once the provider has confirmed the interrupt, which can take a while, and until then a
// late click on a card is still accepted. The moment the person asks to stop, every pending
// ask of that run is answered `cancel` here, so nothing can be approved into a stopped run.

import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2RunStatus,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type RunId,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { policyDecisionAnswers } from "@t3tools/skycot-rules/decision";
import { parseApprovedDownload, parseApprovedInstall } from "@t3tools/skycot-rules/addons";
import {
  evaluateFamilyRequest,
  isReadOnlyCommand,
  projectApprovalCoverFor,
  type FamilyEvaluation,
} from "@t3tools/skycot-rules/family";
import { workRootsFor } from "@t3tools/skycot-rules/questions";
import {
  evaluateRequest,
  type RuleContext,
  type RuleEvaluation,
  type RuleRequest,
} from "@t3tools/skycot-rules/rules";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotQuestions from "./questions/SkycotQuestions.ts";
import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyExtras from "./SkycotFamilyExtras.ts";
import * as SkycotFamilyInstructions from "./SkycotFamilyInstructions.ts";
import { appliesToRuntimeMode, requestFacts } from "./SkycotPolicy.ts";

export type SkycotPolicyOutcome =
  | { readonly type: "skipped"; readonly reason: string }
  | {
      readonly type: "held";
      readonly evaluation: RuleEvaluation;
      /** Family profile on: the Family rules' judgement too (its `needsGrownUp` is why). */
      readonly family?: FamilyEvaluation;
    }
  | {
      readonly type: "approved";
      readonly evaluation: RuleEvaluation;
      /** Family profile on: always `needsGrownUp: false` (see `mayAutoApprove`). */
      readonly family?: FamilyEvaluation;
    }
  /** Stop was pressed: these pending asks were answered `cancel` on the person's behalf. */
  | { readonly type: "cancelled"; readonly requestIds: ReadonlyArray<RuntimeRequestId> };

export class SkycotPolicyReactor extends Context.Service<
  SkycotPolicyReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Runs for every domain event; returns what it did so tests can assert on it. */
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<SkycotPolicyOutcome>;
  }
>()("t3/skycot/SkycotPolicyReactor") {}

const skipped = (reason: string): SkycotPolicyOutcome => ({ type: "skipped", reason });

const AUTO_KINDS: ReadonlySet<OrchestrationV2RuntimeRequest["kind"]> = new Set([
  "command",
  "file-change",
  "file-read",
  "permission",
  "mcp-elicitation",
]);

const SETTLED_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

export function policyCommandId(threadId: ThreadId, requestId: RuntimeRequestId): CommandId {
  return CommandId.make(`server:skycot-policy:${threadId}:${requestId}`);
}

export function stopCommandId(threadId: ThreadId, requestId: RuntimeRequestId): CommandId {
  return CommandId.make(`server:skycot-stop:${threadId}:${requestId}`);
}

/**
 * The one test every server-side yes passes. A Codex command held only for internet access or
 * unreadable code can pass only when this governed turn's workspace sandbox is explicitly
 * network-off. Install/download commands and every other hard or Family hold still need a person.
 */
export function mayAutoApprove(
  evaluation: RuleEvaluation,
  family: FamilyEvaluation | undefined,
  options: {
    readonly codexNetworkLocked?: boolean;
    readonly command?: string | undefined;
    readonly webSearch?: boolean | undefined;
  } = {},
): boolean {
  // A Family relief (a trusted add-on SKYCOT fetches itself, a repeat of one a grown-up allowed
  // in this conversation, an undoable delete in the project) is the shared rules' own judgement
  // of exactly the holds it answers; anything else that held still holds (family.ts reliefFor).
  if (family?.relief !== undefined) return !family.needsGrownUp && family.base.decision !== "hold";
  if (options.codexNetworkLocked && family !== undefined) {
    const familyIds = family.family.map((match) => match.rule.id);
    // Inline code that reaches files is not contained: Codex's sandbox still lets it read
    // anything on the Mac (family.ts `reachesComputer`).
    const internetContained =
      familyIds.length === 1 &&
      (familyIds[0] === "uses-internet" || familyIds[0] === "opaque-code") &&
      !family.family.some((match) => match.reachesComputer === true);
    // No hard rule at all, and above all not "leaves-sandbox": that is Codex asking to run the
    // command OUTSIDE its sandbox, where a yes would put it on the internet.
    const staysInSandbox = evaluation.matches.length === 0 && family.base.matches.length === 0;
    const isInstallerOrDownload =
      options.command !== undefined &&
      (parseApprovedInstall(options.command) !== null ||
        parseApprovedDownload(options.command) !== null);
    if (
      internetContained &&
      options.webSearch !== true &&
      options.command !== undefined &&
      !isInstallerOrDownload &&
      staysInSandbox
    ) {
      return true;
    }
  }
  if (evaluation.decision === "hold") return false;
  if (family === undefined) return true;
  return !family.needsGrownUp && family.base.decision !== "hold";
}

/**
 * Plan first, in Family: while the turn is making its plan, only steps that just look run by
 * themselves (reading files, commands that only list, print or search). A change waits for the
 * child's card, so nothing changes before they press "Build it".
 */
export function onlyLooks(facts: RuleRequest): boolean {
  if (facts.kind === "file-read") return true;
  return (
    facts.kind === "command" &&
    facts.leavesSandbox !== true &&
    facts.command !== undefined &&
    isReadOnlyCommand(facts.command)
  );
}

/** Only a push can be judged by branch, so only a push pays for the two git lookups. */
export function needsBranchContext(facts: RuleRequest): boolean {
  return (
    facts.kind === "command" &&
    facts.command !== undefined &&
    /\bgit\b[\s\S]*\bpush\b/.test(facts.command)
  );
}

// nondev-seam: skycot-project-approval-enforcement
const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fsOption = yield* Effect.serviceOption(FileSystem.FileSystem);
  const pathOption = yield* Effect.serviceOption(Path.Path);
  const git = yield* GitVcsDriver.GitVcsDriver;
  // Optional so the layer's type is unchanged; server.ts provides it at the top.
  const family = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  const familyOn = Option.isNone(family) ? Effect.succeed(false) : family.value.isEnabled;
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;
  const familyExtras = yield* SkycotFamilyExtras.make;
  // Who a Family conversation belongs to and whether their safe steps may run by themselves.
  // The gate's own limits service when this layer is given one (tests); otherwise a read-only
  // reader of the same activity file, as the model fallback builds (it never counts or writes).
  // Without either, nothing is approved in Family: every step keeps its card, as before.
  const stepRules = yield* Effect.gen(function* () {
    const provided = yield* Effect.serviceOption(SkycotFamilyLimits.SkycotFamilyLimits);
    if (Option.isSome(provided) || Option.isNone(family)) return provided;
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
    const path = yield* Effect.serviceOption(Path.Path);
    if (Option.isNone(config) || Option.isNone(fs) || Option.isNone(path)) return Option.none();
    return Option.some(
      yield* SkycotFamilyLimits.makeAt(
        path.value.join(config.value.stateDir, SkycotFamilyLimits.ACTIVITY_FILE_NAME),
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs.value),
        Effect.provideService(Path.Path, path.value),
        Effect.provideService(SkycotFamily.SkycotFamily, family.value),
      ),
    );
  });
  const familyStepRule = (threadId: ThreadId): Effect.Effect<SkycotFamilyLimits.FamilyStepRule> =>
    Option.isNone(stepRules)
      ? Effect.succeed({ type: "ask", reason: "no-child", childId: null })
      : stepRules.value.stepRuleFor({ threadId }).pipe(
          Effect.catchCause(() =>
            Effect.succeed<SkycotFamilyLimits.FamilyStepRule>({
              type: "ask",
              reason: "no-child",
              childId: null,
            }),
          ),
        );

  const projectGrantCovers = Effect.fnUntraced(function* (
    thread: { readonly id: ThreadId; readonly projectId: ProjectId },
    cwd: string,
    cover: ReturnType<typeof projectApprovalCoverFor>,
    childId: string,
  ) {
    if (
      cover === null ||
      Option.isNone(family) ||
      Option.isNone(fsOption) ||
      Option.isNone(pathOption)
    )
      return false;
    const project = yield* projects.get(thread.projectId);
    if (Option.isNone(project)) return false;
    const path = pathOption.value;
    const projectPath = yield* fsOption.value
      .realPath(project.value.workspaceRoot)
      .pipe(Effect.orElseSucceed(() => ""));
    const workingPath = yield* fsOption.value.realPath(cwd).pipe(Effect.orElseSucceed(() => ""));
    if (projectPath.length === 0 || workingPath.length === 0) return false;
    const relative = path.relative(projectPath, workingPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return false;
    const status = yield* family.value.status.pipe(Effect.orElseSucceed(() => null));
    return (
      status?.projectApprovalGrants.some(
        (grant) =>
          grant.childId === childId &&
          grant.projectPath === projectPath &&
          grant.covers.includes(cover),
      ) ?? false
    );
  });

  /**
   * The branch the push would send and the branch everyone sees. A thread with a private
   * copy knows its branch; a plain folder asks git. Anything that fails stays null, and the
   * rules hold a bare push whose branch nobody knows.
   */
  const branchContextFor = Effect.fnUntraced(function* (
    thread: { readonly branch: string | null },
    projectRoot: string | null,
  ): Generator<
    Effect.Effect<unknown, never>,
    Pick<RuleContext, "currentBranch" | "defaultBranch">
  > {
    if (projectRoot === null) return { currentBranch: thread.branch, defaultBranch: null };
    const currentBranch =
      thread.branch ??
      (yield* git.statusDetailsLocal(projectRoot).pipe(
        Effect.map((details) => details.branch),
        Effect.orElseSucceed(() => null),
      ));
    const defaultBranch = yield* git.resolvePrimaryRemoteName(projectRoot).pipe(
      Effect.flatMap((remote) => git.resolveDefaultBranchName(projectRoot, remote)),
      Effect.orElseSucceed(() => null),
    );
    return { currentBranch, defaultBranch };
  });

  const toolCallFor = Effect.fnUntraced(function* (
    threadId: ThreadId,
    approval: Extract<OrchestrationV2TurnItem, { type: "approval_request" }>,
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
    if (Option.isNone(fsOption)) return roots;
    const real = (value: string | null) =>
      value === null
        ? Effect.succeed(null)
        : fsOption.value.realPath(value).pipe(Effect.orElseSucceed(() => value));
    return {
      projectRoot: yield* real(roots.projectRoot),
      projectFolder: yield* real(roots.projectFolder),
    };
  });

  /**
   * Whether the run is a Family turn that plans (plan first). Unknown counts as planning: the
   * safe side only ever means one more card.
   */
  const runPlans = Effect.fnUntraced(function* (
    thread: { readonly id: ThreadId; readonly interactionMode: ProviderInteractionMode },
    runId: RunId | null,
  ) {
    if (runId === null) return true;
    const records = yield* projections.getThreadRecords(thread.id, ["runs"], { runIds: [runId] });
    const run = records.runs.find((candidate) => candidate.id === runId);
    if (run === undefined || typeof run.userMessageId !== "string") return true;
    return yield* SkycotFamilyInstructions.familyTurnPlans(
      run.userMessageId,
      thread.interactionMode,
    );
  });

  /** False once the person asked to stop the run, or the run has already settled. */
  const runStillActive = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const records = yield* projections.getThreadRecords(threadId, ["runs", "turnItems"], {
      runIds: [runId],
      turnItemRunIds: [runId],
      turnItemTypes: ["run_interrupt_request"],
    });
    if (records.turnItems.length > 0) return false;
    const run = records.runs.find((candidate) => candidate.id === runId);
    return run === undefined || !SETTLED_RUN_STATUSES.has(run.status);
  });

  const decide = Effect.fn("SkycotPolicyReactor.decide")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: RuntimeRequestId;
    readonly driver: ProviderDriverKind | undefined;
  }) {
    // Family: every conversation is governed, whatever mode it was made in (the provider is
    // told to ask before every step, SkycotPolicy.familyRuntimePolicy).
    const inFamily = yield* familyOn;
    const thread = yield* projections.getThread(input.threadId);
    if (!inFamily && !appliesToRuntimeMode(thread.runtimeMode)) {
      return skipped("runtime mode not governed");
    }
    if (thread.archivedAt !== null || thread.deletedAt !== null) return skipped("thread closed");
    const request = yield* projections.getRuntimeRequest(input.threadId, input.requestId);
    if (request === undefined) return skipped("request missing");
    if (request.status !== "pending") return skipped(`request ${request.status}`);
    if (request.responseCapability.type !== "live") return skipped("request not live");
    if (!AUTO_KINDS.has(request.kind)) return skipped(`kind ${request.kind} is the person's`);
    const approval = yield* projections.getTurnItem({
      threadId: input.threadId,
      itemId: IdAllocator.derive.approvalTurnItem({ requestId: input.requestId }),
    });
    if (approval === null || approval.type !== "approval_request") {
      // The turn item lands in the same batch; its own event re-enters here.
      return skipped("approval item not stored yet");
    }
    if (approval.runId !== null && !(yield* runStillActive(input.threadId, approval.runId))) {
      // Stop was pressed (or the run ended): never approve into a run that is going away.
      return skipped("run no longer active");
    }
    if (inFamily) {
      // The child's card stays when their parent wants them asked, when SKYCOT is asleep for
      // them (the gate refuses their yes until morning), or when nobody knows whose it is.
      const rule = yield* familyStepRule(input.threadId);
      if (rule.type !== "auto") return skipped(`family: ${rule.reason}`);
    }
    const toolCall = yield* toolCallFor(input.threadId, approval, input.driver);
    const facts = requestFacts(approval, toolCall, input.driver);
    if (facts === null) return skipped("request kind unknown");
    const roots = yield* projectRootsFor(thread);
    const branches = needsBranchContext(facts)
      ? yield* branchContextFor(thread, roots.projectRoot)
      : {};
    const evaluation = evaluateRequest(facts, { ...roots, ...branches });
    // The same judgement the gate gives the child's card (SkycotFamilyGate.describeRequest):
    // a step that needs a grown-up there needs one here.
    const extras = inFamily
      ? yield* familyExtras({
          threadId: input.threadId,
          driver: approval.nativeItemRef?.driver ?? input.driver,
        })
      : {};
    const familyEvaluation = inFamily
      ? evaluateFamilyRequest(
          { ...facts, toolItemType: toolCall?.type },
          { ...roots, ...branches, ...extras },
        )
      : undefined;
    const projectCover =
      familyEvaluation === undefined
        ? null
        : projectApprovalCoverFor(
            { ...facts, toolItemType: toolCall?.type },
            familyEvaluation,
            roots,
          );
    const stepRule = inFamily ? yield* familyStepRule(input.threadId) : null;
    if (
      familyEvaluation?.needsGrownUp === true &&
      familyEvaluation.base.decision !== "hold" &&
      stepRule?.type === "auto" &&
      (yield* projectGrantCovers(thread, roots.projectRoot ?? "", projectCover, stepRule.childId))
    ) {
      yield* engine.dispatch({
        type: "runtime-request.respond",
        commandId: policyCommandId(input.threadId, input.requestId),
        threadId: input.threadId,
        requestId: input.requestId,
        decision: "accept",
        answers: policyDecisionAnswers(evaluation),
      });
      yield* Effect.logInfo("skycot-policy.project-approved", {
        threadId: input.threadId,
        requestId: input.requestId,
        cover: projectCover,
      });
      return {
        type: "approved",
        evaluation,
        family: familyEvaluation,
      } satisfies SkycotPolicyOutcome;
    }
    if (
      familyEvaluation !== undefined &&
      !familyEvaluation.needsGrownUp &&
      !onlyLooks(facts) &&
      (yield* runPlans(thread, approval.runId))
    ) {
      return skipped("family: plan first (changes wait for Build it)");
    }
    const driver = approval.nativeItemRef?.driver ?? input.driver;
    // These are exactly the modes familyRuntimePolicy and the policy override send to the
    // adapter, which puts networkAccess:false on each Codex turn/start request.
    const codexNetworkLocked =
      driver === "codex" && (inFamily || appliesToRuntimeMode(thread.runtimeMode));
    if (
      !mayAutoApprove(evaluation, familyEvaluation, {
        codexNetworkLocked,
        command: facts.kind === "command" ? facts.command : undefined,
        webSearch: toolCall?.type === "web_search",
      })
    ) {
      yield* Effect.logInfo("skycot-policy.held", {
        threadId: input.threadId,
        requestId: input.requestId,
        rules: evaluation.matches.map((match) => match.rule.id),
        ...(familyEvaluation === undefined
          ? {}
          : { familyRules: familyEvaluation.family.map((match) => match.rule.id) }),
      });
      return {
        type: "held",
        evaluation,
        ...(familyEvaluation === undefined ? {} : { family: familyEvaluation }),
      } satisfies SkycotPolicyOutcome;
    }
    yield* engine.dispatch({
      type: "runtime-request.respond",
      commandId: policyCommandId(input.threadId, input.requestId),
      threadId: input.threadId,
      requestId: input.requestId,
      decision: "accept",
      answers:
        familyEvaluation?.relief === undefined
          ? policyDecisionAnswers(evaluation)
          : policyDecisionAnswers(familyEvaluation.base, {
              relief: familyEvaluation.relief,
              addOns: familyEvaluation.addOns,
            }),
    });
    yield* Effect.logInfo("skycot-policy.approved", {
      threadId: input.threadId,
      requestId: input.requestId,
      kind: request.kind,
      family: inFamily,
      ...(familyEvaluation?.relief === undefined ? {} : { relief: familyEvaluation.relief }),
    });
    return {
      type: "approved",
      evaluation,
      ...(familyEvaluation === undefined ? {} : { family: familyEvaluation }),
    } satisfies SkycotPolicyOutcome;
  });

  // Stop pressed: answer every pending ask of that run with `cancel` now, before the
  // provider has even acknowledged the interrupt.
  const cancelPendingAsks = Effect.fn("SkycotPolicyReactor.cancelPendingAsks")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) {
    const recovery = yield* projections.getRuntimeRecoveryProjection(input.threadId);
    const askedByRun = new Set(
      recovery.turnItems.flatMap((item) =>
        item.runId === input.runId &&
        (item.type === "approval_request" || item.type === "user_input_request")
          ? [item.requestId]
          : [],
      ),
    );
    const nodesOfRun = new Set(
      recovery.nodes.filter((node) => node.runId === input.runId).map((node) => node.id),
    );
    const pending = recovery.runtimeRequests.filter(
      (request) =>
        request.status === "pending" &&
        request.responseCapability.type === "live" &&
        (askedByRun.has(request.id) || nodesOfRun.has(request.nodeId)),
    );
    const cancelled: Array<RuntimeRequestId> = [];
    for (const request of pending) {
      const sent = yield* engine
        .dispatch({
          type: "runtime-request.respond",
          commandId: stopCommandId(input.threadId, request.id),
          threadId: input.threadId,
          requestId: request.id,
          decision: "cancel",
        })
        .pipe(
          Effect.as(true),
          // Already answered or already cancelled by the engine: nothing to do.
          Effect.catchCause((cause) =>
            Effect.logDebug("skycot-stop.respond-failed", {
              threadId: input.threadId,
              requestId: request.id,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (sent) cancelled.push(request.id);
    }
    if (cancelled.length > 0) {
      yield* Effect.logInfo("skycot-stop.cancelled-pending-asks", {
        threadId: input.threadId,
        runId: input.runId,
        requestIds: cancelled,
      });
    }
    return { type: "cancelled", requestIds: cancelled } satisfies SkycotPolicyOutcome;
  });

  // Runs for every domain event; most events return before any work is needed. Both the
  // request event and the approval item's event are handled because the adapters emit them
  // in the same batch and either may be stored first.
  const handle: SkycotPolicyReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "run_interrupt_request" &&
        event.payload.runId !== null
      ) {
        return yield* cancelPendingAsks({ threadId: event.threadId, runId: event.payload.runId });
      }
      if (event.type === "runtime-request.updated") {
        if (event.payload.status !== "pending") return skipped("not pending");
        return yield* decide({
          threadId: event.threadId,
          requestId: event.payload.id,
          driver: event.driver,
        });
      }
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "approval_request" &&
        event.payload.status === "waiting"
      ) {
        return yield* decide({
          threadId: event.threadId,
          requestId: event.payload.requestId,
          driver: event.driver,
        });
      }
      return skipped("not an approval event");
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot policy could not decide a runtime request", {
            threadId: event.threadId,
            cause,
          }).pipe(Effect.as(skipped("failed"))),
        ),
      ),
  );

  const start: SkycotPolicyReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        handle(event).pipe(Effect.asVoid),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("skycot policy event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies SkycotPolicyReactor["Service"];
});

/** Disabled: never subscribes, never dispatches. */
const layerDisabled = Layer.succeed(
  SkycotPolicyReactor,
  SkycotPolicyReactor.of({
    start: () => Effect.void,
    handle: () => Effect.succeed(skipped("policy disabled")),
  }),
);

export function layer(options: {
  readonly enabled: boolean;
}): Layer.Layer<
  SkycotPolicyReactor,
  never,
  | Orchestrator.OrchestratorV2
  | ProjectionStore.ProjectionStoreV2
  | ProjectStore.ProjectStoreV2
  | GitVcsDriver.GitVcsDriver
> {
  return options.enabled ? Layer.effect(SkycotPolicyReactor, make) : layerDisabled;
}
