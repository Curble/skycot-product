// nondev-seam: skycot-policy-reactor-network-guard-test
// nondev-seam: skycot-project-approval-enforcement-test
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  type RunId,
  type RuntimeMode,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CodexSchema from "effect-codex-app-server/schema";

import { SKYCOT_POLICY_NOTE } from "@t3tools/skycot-rules/decision";
import { UNKNOWN_BRANCH_PUSH } from "@t3tools/skycot-rules/rules";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { GitCommandError } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { evaluateFamilyRequest } from "@t3tools/skycot-rules/family";
import { evaluateRequest } from "@t3tools/skycot-rules/rules";

import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import { ADD_ON_FILE_NAME, withApproval, type AddOnFile } from "./SkycotAddOnApprovals.ts";
import { parseApprovedDownload, parseApprovedInstall } from "./SkycotApprovedInstalls.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyInstructions from "./SkycotFamilyInstructions.ts";
import * as SkycotPolicyReactor from "./SkycotPolicyReactor.ts";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const NOW = DateTime.makeUnsafe("2026-10-21T09:00:00.000Z");
const THREAD_ID = ThreadId.make("thread:skycot");
const PROJECT_ID = ProjectId.make("project:skycot");
const REQUEST_ID = RuntimeRequestId.make("req-1");
const SESSION_ID = ProviderSessionId.make("session-1");
type RespondCommand = Extract<OrchestrationV2Command, { readonly type: "runtime-request.respond" }>;

function thread(
  runtimeMode: RuntimeMode,
  worktreePath: string | null,
  branch: string | null = null,
): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Skycot",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    runtimeMode,
    interactionMode: "default",
    branch,
    worktreePath,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    forkedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function request(
  kind: OrchestrationV2RuntimeRequest["kind"],
  status: OrchestrationV2RuntimeRequest["status"] = "pending",
): OrchestrationV2RuntimeRequest {
  return {
    id: REQUEST_ID,
    nodeId: "node:approval" as never,
    providerTurnId: null,
    nativeRequestRef: { driver: CODEX, nativeId: "item-1", strength: "strong" },
    kind,
    status,
    responseCapability: { type: "live", providerSessionId: SESSION_ID },
    createdAt: NOW,
    resolvedAt: null,
  };
}

const base = {
  threadId: THREAD_ID,
  runId: null,
  nodeId: "node:approval" as never,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: { driver: CODEX, nativeId: "item-1", strength: "strong" as const },
  parentItemId: null,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: NOW,
};

function approvalItem(
  requestKind: "command" | "file-change" | "file-read" | "permission",
  prompt?: string,
): OrchestrationV2TurnItem {
  return {
    ...base,
    id: TurnItemId.make("turn-item:runtime-request:req-1"),
    ordinal: 1,
    status: "waiting",
    type: "approval_request",
    requestId: REQUEST_ID,
    requestKind,
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function commandItem(input: string): OrchestrationV2TurnItem {
  return {
    ...base,
    id: TurnItemId.make("turn-item:provider:codex:native-item:item-1"),
    ordinal: 0,
    status: "running",
    type: "command_execution",
    input,
  };
}

function requestEvent(payload: OrchestrationV2RuntimeRequest): OrchestrationV2DomainEvent {
  return {
    id: EventId.make("event-1"),
    threadId: THREAD_ID,
    driver: CODEX,
    occurredAt: NOW,
    type: "runtime-request.updated",
    payload,
  };
}

function itemEvent(payload: OrchestrationV2TurnItem): OrchestrationV2DomainEvent {
  return {
    id: EventId.make("event-2"),
    threadId: THREAD_ID,
    driver: CODEX,
    occurredAt: NOW,
    type: "turn-item.updated",
    payload,
  };
}

interface Scenario {
  readonly thread?: OrchestrationV2AppThread;
  readonly request?: OrchestrationV2RuntimeRequest;
  readonly items?: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly enabled?: boolean;
  /** What git says about the folder: its checked-out branch and the remote's default. */
  readonly git?:
    | { readonly branch: string | null; readonly defaultBranch: string | null }
    | "broken";
  /** Pending requests the recovery projection reports, for the Stop path. */
  readonly pendingRequests?: ReadonlyArray<OrchestrationV2RuntimeRequest>;
  /** Run statuses by id, for the "run no longer active" guard. */
  readonly runs?: Readonly<Record<string, OrchestrationV2Run["status"]>>;
  /**
   * The Family profile is on. `true` alone: no limits service, so nobody knows whose the
   * conversation is. An object: the step rule the limits service gives this conversation.
   */
  readonly family?: boolean | { readonly stepRule: SkycotFamilyLimits.FamilyStepRule };
  /** The user message each run answers, by run id (for plan first). */
  readonly runMessages?: Readonly<Record<string, string>>;
  /** The parent's "Trusted add-ons download by themselves"; unset: unreadable (no relief). */
  readonly trustedAddOns?: boolean;
  /** The conversation's restore points, for undoable deletes. */
  readonly checkpoints?: ReadonlyArray<{ readonly status: string }>;
  /** SKYCOT's add-on memory, written to a temporary engine home first. */
  readonly addOnFile?: AddOnFile;
  readonly projectPath?: string;
  readonly projectGrants?: ReadonlyArray<SkycotFamily.ProjectApprovalGrant>;
}

const gitFailure = (operation: string) =>
  new GitCommandError({
    operation,
    command: "git",
    cwd: "/work/site",
    exitCode: 128,
    detail: "no git",
  });

const run = (scenario: Scenario, event: OrchestrationV2DomainEvent) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<RespondCommand>>([]);
    const items = scenario.items ?? [];
    const home =
      scenario.addOnFile === undefined
        ? null
        : yield* Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const dir = yield* fs.makeTempDirectory({ prefix: "skycot-reactor-" });
            yield* fs.writeFileString(
              `${dir}/${ADD_ON_FILE_NAME}`,
              JSON.stringify(scenario.addOnFile),
            );
            return dir;
          }).pipe(Effect.provide(NodeServices.layer));
    const layerDependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: () =>
          Effect.succeed(scenario.thread ?? thread("auto-accept-edits", "/work/site")),
        getRuntimeRequest: () => Effect.succeed(scenario.request ?? request("command")),
        getTurnItem: ({ itemId }) =>
          Effect.succeed(items.find((item) => item.id === itemId) ?? null),
        getThreadRecords: (_threadId, _fields, filter) =>
          Effect.succeed({
            thread: scenario.thread ?? thread("auto-accept-edits", "/work/site"),
            runs: Object.entries(scenario.runs ?? {})
              .filter(([id]) => filter?.runIds === undefined || filter.runIds.includes(id as RunId))
              .map(
                ([id, status]) =>
                  ({
                    id,
                    status,
                    ...(scenario.runMessages?.[id] === undefined
                      ? {}
                      : { userMessageId: scenario.runMessages[id] }),
                  }) as unknown as OrchestrationV2Run,
              ),
            checkpoints: scenario.checkpoints ?? [],
            turnItems: items.filter(
              (item) =>
                (filter?.turnItemRunIds === undefined ||
                  filter.turnItemRunIds.includes(item.runId)) &&
                (filter?.turnItemTypes === undefined || filter.turnItemTypes.includes(item.type)),
            ),
          }) as never,
        getRuntimeRecoveryProjection: () =>
          Effect.succeed({
            thread: scenario.thread ?? thread("auto-accept-edits", "/work/site"),
            runs: [],
            attempts: [],
            nodes: [],
            subagents: [],
            providerSessions: [],
            providerThreads: [],
            providerTurns: [],
            runtimeRequests: scenario.pendingRequests ?? [],
            messages: [],
            turnItems: items,
          }),
      }),
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        statusDetailsLocal: () =>
          scenario.git === "broken" || scenario.git === undefined
            ? Effect.fail(gitFailure("statusDetailsLocal"))
            : Effect.succeed({
                isRepo: true,
                hasOriginRemote: true,
                isDefaultBranch: false,
                branch: scenario.git.branch,
                upstreamRef: null,
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: false,
                aheadCount: 0,
                behindCount: 0,
                aheadOfDefaultCount: 0,
              }),
        resolvePrimaryRemoteName: () =>
          scenario.git === "broken" || scenario.git === undefined
            ? Effect.fail(gitFailure("resolvePrimaryRemoteName"))
            : Effect.succeed("origin"),
        resolveDefaultBranchName: () =>
          scenario.git === "broken" || scenario.git === undefined
            ? Effect.fail(gitFailure("resolveDefaultBranchName"))
            : Effect.succeed(scenario.git.defaultBranch),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeed(
            Option.some({
              projectId: PROJECT_ID,
              title: "Project",
              workspaceRoot: scenario.projectPath ?? "/projects/site",
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: "2026-06-21T00:00:00.000Z",
              updatedAt: "2026-06-21T00:00:00.000Z",
              deletedAt: null,
            }),
          ),
      }),
      scenario.family === undefined || scenario.family === false
        ? Layer.empty
        : Layer.mock(SkycotFamily.SkycotFamily)({
            isEnabled: Effect.succeed(true),
            ...(scenario.projectGrants === undefined
              ? {}
              : {
                  status: Effect.succeed({
                    projectApprovalGrants: scenario.projectGrants,
                  } as never),
                }),
            ...(scenario.trustedAddOns === undefined
              ? {}
              : { trustedAddOnsOn: Effect.succeed(scenario.trustedAddOns) }),
          }),
      home === null
        ? Layer.empty
        : Layer.merge(
            NodeServices.layer,
            Layer.succeed(ServerConfig.ServerConfig, { stateDir: home, baseDir: home } as never),
          ),
      typeof scenario.family === "object"
        ? Layer.mock(SkycotFamilyLimits.SkycotFamilyLimits)({
            stepRuleFor: () =>
              Effect.succeed(
                (scenario.family as { readonly stepRule: SkycotFamilyLimits.FamilyStepRule })
                  .stepRule,
              ),
          })
        : Layer.empty,
      Layer.mock(Orchestrator.OrchestratorV2)({
        dispatch: (command) =>
          command.type === "runtime-request.respond"
            ? Ref.update(dispatched, (all) => [...all, command]).pipe(
                Effect.as({ sequence: 1, storedEvents: [] }),
              )
            : Effect.die(new Error(`Unexpected command: ${command.type}`)),
        streamDomainEvents: Stream.empty,
      }),
    );
    const outcome = yield* Effect.gen(function* () {
      const reactor = yield* SkycotPolicyReactor.SkycotPolicyReactor;
      return yield* reactor.handle(event);
    }).pipe(
      Effect.provide(
        SkycotPolicyReactor.layer({ enabled: scenario.enabled ?? true }).pipe(
          Layer.provide(layerDependencies),
        ),
      ),
    );
    return { outcome, dispatched: yield* Ref.get(dispatched) };
  });

describe("SkycotPolicyReactor", () => {
  it.effect("approves nothing in Family when it cannot tell whose conversation it is", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        {
          family: true,
          items: [approvalItem("command", "pnpm test"), commandItem("pnpm test")],
        },
        requestEvent(request("command")),
      );
      assert.deepEqual(outcome, { type: "skipped", reason: "family: no-child" });
      assert.equal(dispatched.length, 0);
    }),
  );

  it.effect("approves a routine in-project command and signs the decision", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        { items: [approvalItem("command", "pnpm test"), commandItem("pnpm test")] },
        requestEvent(request("command")),
      );
      assert.equal(outcome.type, "approved");
      assert.equal(dispatched.length, 1);
      const command = dispatched[0]!;
      assert.equal(command.requestId, REQUEST_ID);
      assert.equal(command.decision, "accept");
      assert.equal(command.commandId, `server:skycot-policy:${THREAD_ID}:${REQUEST_ID}`);
      assert.deepEqual(command.answers, {
        skycot: { decidedBy: "policy", note: SKYCOT_POLICY_NOTE, ruleIds: [], version: 1 },
      });
    }),
  );

  it.effect("holds a delete the approval's own prompt does not show", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        { items: [approvalItem("command"), commandItem("rm book.html")] },
        requestEvent(request("command")),
      );
      assert.equal(outcome.type, "held");
      assert.deepEqual(dispatched, []);
      if (outcome.type === "held") {
        assert.deepEqual(
          outcome.evaluation.matches.map((match) => match.rule.id),
          ["deletes-files"],
        );
      }
    }),
  );

  it.effect("holds reads outside the private copy and allows reads inside it", () =>
    Effect.gen(function* () {
      const outside = yield* run(
        {
          items: [
            approvalItem("command"),
            commandItem("cat /Users/me/t3code-nondev/AGENTS.md"),
          ],
        },
        requestEvent(request("command")),
      );
      assert.equal(outside.outcome.type, "held");
      const inside = yield* run(
        { items: [approvalItem("command"), commandItem("cat /work/site/AGENTS.md")] },
        requestEvent(request("command")),
      );
      assert.equal(inside.outcome.type, "approved");
    }),
  );

  it.effect("falls back to the project folder when the thread has no private copy", () =>
    Effect.gen(function* () {
      const { outcome } = yield* run(
        {
          thread: thread("auto-accept-edits", null),
          items: [approvalItem("command"), commandItem("cat /projects/site/index.html")],
        },
        requestEvent(request("command")),
      );
      assert.equal(outcome.type, "approved");
    }),
  );

  // The engine names a private copy after the project, spaces and all; an edit inside it, or
  // in the project's own folder, is in the project.
  it.effect("approves edits in a private copy whose path has spaces, holds the real folder", () =>
    Effect.gen(function* () {
      const copy = "/home/kid/.t3/worktrees/Little Fern Café website/skycot-menu-eedf";
      const edit = (prompt: string) =>
        run(
          {
            thread: thread("auto-accept-edits", copy),
            request: request("file-change"),
            items: [approvalItem("file-change", prompt)],
          },
          requestEvent(request("file-change")),
        );
      assert.equal((yield* edit(`add ${copy}/christmas.html`)).outcome.type, "approved");
      // Undo restores the private copy, never the project's own folder: that edit is a question.
      const real = (yield* edit("update /projects/site/menu.html")).outcome;
      assert.equal(real.type, "held");
      assert.deepEqual(
        real.type === "held" ? real.evaluation.matches.map((match) => match.rule.id) : [],
        ["changes-real-project"],
      );
      assert.equal(
        (yield* edit("update /home/kid/.t3/worktrees/Little Fern Café website/other/a.html"))
          .outcome.type,
        "held",
      );
    }),
  );

  it.effect("holds file deletes and edits outside the project, approves ordinary edits", () =>
    Effect.gen(function* () {
      const del = yield* run(
        {
          request: request("file-change"),
          items: [approvalItem("file-change", "delete /work/site/book.html")],
        },
        requestEvent(request("file-change")),
      );
      assert.equal(del.outcome.type, "held");
      const outside = yield* run(
        {
          request: request("file-change"),
          items: [approvalItem("file-change", "update /etc/hosts")],
        },
        requestEvent(request("file-change")),
      );
      assert.equal(outside.outcome.type, "held");
      const edit = yield* run(
        {
          request: request("file-change"),
          items: [approvalItem("file-change", "update /work/site/index.html")],
        },
        requestEvent(request("file-change")),
      );
      assert.equal(edit.outcome.type, "approved");
    }),
  );

  it.effect("never approves what it cannot read, and leaves connected apps to the person", () =>
    Effect.gen(function* () {
      const blind = yield* run(
        { items: [approvalItem("command")] },
        requestEvent(request("command")),
      );
      assert.equal(blind.outcome.type, "held");
      const app = yield* run(
        { request: request("permission"), items: [approvalItem("permission", "Use GitHub")] },
        requestEvent(request("permission")),
      );
      assert.equal(app.outcome.type, "held");
    }),
  );

  it.effect("only governs auto-accept-edits threads, pending live requests, and the flag", () =>
    Effect.gen(function* () {
      const items = [approvalItem("command"), commandItem("pnpm test")];
      for (const mode of ["approval-required", "auto", "full-access"] as const) {
        const { outcome, dispatched } = yield* run(
          { thread: thread(mode, "/work/site"), items },
          requestEvent(request("command")),
        );
        assert.equal(outcome.type, "skipped");
        assert.deepEqual(dispatched, []);
      }
      const resolved = yield* run(
        { request: request("command", "resolved"), items },
        requestEvent(request("command", "resolved")),
      );
      assert.equal(resolved.outcome.type, "skipped");
      const off = yield* run({ items, enabled: false }, requestEvent(request("command")));
      assert.equal(off.outcome.type, "skipped");
      const question = yield* run(
        { request: request("user_input"), items },
        requestEvent(request("user_input")),
      );
      assert.equal(question.outcome.type, "skipped");
    }),
  );

  it.effect("holds every runner-wrapped deploy the same as the bare program", () =>
    Effect.gen(function* () {
      for (const command of [
        "npx vercel --prod",
        "pnpm dlx netlify deploy --prod",
        "bunx wrangler deploy",
        "sudo npm exec -- vercel deploy --prod",
        "/bin/zsh -lc 'cd /work/site && npx -y vercel --prod'",
      ]) {
        const { outcome, dispatched } = yield* run(
          { items: [approvalItem("command"), commandItem(command)] },
          requestEvent(request("command")),
        );
        assert.equal(outcome.type, "held", command);
        assert.deepEqual(dispatched, []);
      }
      const benign = yield* run(
        { items: [approvalItem("command"), commandItem("npx prettier --write .")] },
        requestEvent(request("command")),
      );
      assert.equal(benign.outcome.type, "approved");
    }),
  );

  it.effect("judges a bare git push by the thread's branch and the repo's default branch", () =>
    Effect.gen(function* () {
      const items = [approvalItem("command"), commandItem("git push")];
      const feature = yield* run(
        {
          thread: thread("auto-accept-edits", "/work/site", "skycot/opening-hours"),
          git: { branch: "skycot/opening-hours", defaultBranch: "main" },
          items,
        },
        requestEvent(request("command")),
      );
      assert.equal(feature.outcome.type, "approved");

      // A plain folder has no thread branch: git answers, and it is on the live branch.
      const plainFolder = yield* run(
        {
          thread: thread("auto-accept-edits", null),
          git: { branch: "main", defaultBranch: "main" },
          items,
        },
        requestEvent(request("command")),
      );
      assert.equal(plainFolder.outcome.type, "held");
      if (plainFolder.outcome.type === "held") {
        assert.equal(plainFolder.outcome.evaluation.risk, "high");
      }

      // An unusual default branch counts as live once git names it.
      const unusual = yield* run(
        {
          thread: thread("auto-accept-edits", null),
          git: { branch: "trunk-2026", defaultBranch: "trunk-2026" },
          items,
        },
        requestEvent(request("command")),
      );
      assert.equal(unusual.outcome.type, "held");

      // Git unavailable: hold, as medium, because nobody knows which branch goes up.
      const unknown = yield* run(
        { thread: thread("auto-accept-edits", null), git: "broken", items },
        requestEvent(request("command")),
      );
      assert.equal(unknown.outcome.type, "held");
      if (unknown.outcome.type === "held") {
        assert.equal(unknown.outcome.evaluation.risk, "medium");
        assert.equal(unknown.outcome.evaluation.matches[0]?.held, UNKNOWN_BRANCH_PUSH);
      }

      // No push, no git lookups: a broken git must not stop ordinary approvals.
      const noPush = yield* run(
        {
          thread: thread("auto-accept-edits", null),
          git: "broken",
          items: [approvalItem("command"), commandItem("pnpm test")],
        },
        requestEvent(request("command")),
      );
      assert.equal(noPush.outcome.type, "approved");
    }),
  );

  it.effect("answers the run's pending asks with cancel the moment Stop is requested", () =>
    Effect.gen(function* () {
      const runId = "run-1" as RunId;
      const otherRequestId = RuntimeRequestId.make("req-other");
      const pendingOfRun = request("command");
      const pendingOfOtherRun: OrchestrationV2RuntimeRequest = {
        ...request("command"),
        id: otherRequestId,
        nodeId: "node:other" as never,
      };
      const resolvedOfRun: OrchestrationV2RuntimeRequest = {
        ...request("command", "resolved"),
        id: RuntimeRequestId.make("req-done"),
      };
      const stopItem: OrchestrationV2TurnItem = {
        ...base,
        id: TurnItemId.make("turn-item:run-signal:interrupt-request"),
        runId,
        nativeItemRef: null,
        ordinal: 5,
        status: "completed",
        type: "run_interrupt_request",
        message: "Interrupt requested",
      };
      const { outcome, dispatched } = yield* run(
        {
          thread: thread("approval-required", "/work/site"),
          items: [
            { ...approvalItem("command"), runId },
            {
              ...approvalItem("command"),
              id: TurnItemId.make("turn-item:runtime-request:req-other"),
              requestId: otherRequestId,
              runId: "run-0" as RunId,
            } as OrchestrationV2TurnItem,
            stopItem,
          ],
          pendingRequests: [pendingOfRun, pendingOfOtherRun, resolvedOfRun],
        },
        itemEvent(stopItem),
      );
      assert.equal(outcome.type, "cancelled");
      if (outcome.type === "cancelled") assert.deepEqual(outcome.requestIds, [REQUEST_ID]);
      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0]!.decision, "cancel");
      assert.equal(dispatched[0]!.requestId, REQUEST_ID);
      assert.equal(dispatched[0]!.commandId, `server:skycot-stop:${THREAD_ID}:${REQUEST_ID}`);
    }),
  );

  it.effect("never approves a request whose run was stopped or has ended", () =>
    Effect.gen(function* () {
      const runId = "run-1" as RunId;
      const asked = { ...approvalItem("command"), runId };
      const stopItem: OrchestrationV2TurnItem = {
        ...base,
        id: TurnItemId.make("turn-item:run-signal:interrupt-request"),
        runId,
        nativeItemRef: null,
        ordinal: 5,
        status: "completed",
        type: "run_interrupt_request",
        message: "Interrupt requested",
      };
      const stopping = yield* run(
        { items: [asked, commandItem("pnpm test"), stopItem], runs: { [runId]: "running" } },
        requestEvent(request("command")),
      );
      assert.deepEqual(stopping.outcome, { type: "skipped", reason: "run no longer active" });
      assert.deepEqual(stopping.dispatched, []);

      const ended = yield* run(
        { items: [asked, commandItem("pnpm test")], runs: { [runId]: "interrupted" } },
        requestEvent(request("command")),
      );
      assert.deepEqual(ended.outcome, { type: "skipped", reason: "run no longer active" });

      const live = yield* run(
        { items: [asked, commandItem("pnpm test")], runs: { [runId]: "running" } },
        requestEvent(request("command")),
      );
      assert.equal(live.outcome.type, "approved");
    }),
  );

  it.effect("decides from the approval item's own event when it lands after the request", () =>
    Effect.gen(function* () {
      const noItem = yield* run(
        { items: [commandItem("pnpm test")] },
        requestEvent(request("command")),
      );
      assert.equal(noItem.outcome.type, "skipped");
      assert.deepEqual(noItem.dispatched, []);
      const item = approvalItem("command");
      const later = yield* run({ items: [item, commandItem("pnpm test")] }, itemEvent(item));
      assert.equal(later.outcome.type, "approved");
      assert.equal(later.dispatched.length, 1);
    }),
  );
  // The shape Codex sent in the live re-check (2b): the model asked to run the push outside
  // its sandbox, so `reason` carries its justification and the adapter shows that as the
  // prompt (`reason ?? command`). Decoded through the app-server schema so a drifted field
  // name fails here.
  const decodeCodexApproval = Schema.decodeUnknownSync(
    CodexSchema.CommandExecutionRequestApprovalParams,
  );
  const ESCALATION = decodeCodexApproval({
    kind: "command",
    threadId: "01a15f5e-83fb-7043-8e36-58b5b2fe728e",
    turnId: "01a15f5f-4649-7553-8ebf-3176388c1d9e",
    itemId: "item-1",
    approvalId: "d76063e4-e0a2-4c41-a701-56bfdd56c216",
    startedAtMs: 1792601453371,
    environmentId: "local",
    reason:
      "Allow Git to push this branch to the local remote outside the workspace and set its upstream?",
    command:
      "/bin/zsh -lc 'git push --set-upstream origin skycot/upload-this-branch-plain-git-52d1'",
    cwd: "/work/site",
    commandActions: [
      {
        type: "unknown",
        command: "git push --set-upstream origin skycot/upload-this-branch-plain-git-52d1",
      },
    ],
    proposedExecpolicyAmendment: [
      "git",
      "push",
      "--set-upstream",
      "origin",
      "skycot/upload-this-branch-plain-git-52d1",
    ],
  });

  /** What CodexAdapterV2 stores for an approval: the prompt is `reason ?? command`. */
  const codexAsk = (params: typeof ESCALATION) => [
    approvalItem("command", params.reason ?? params.command ?? undefined),
    commandItem(params.command ?? ""),
  ];

  it.effect("holds a Codex request to leave its sandbox even when the command is harmless", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        {
          thread: thread(
            "auto-accept-edits",
            "/work/site",
            "skycot/upload-this-branch-plain-git-52d1",
          ),
          git: { branch: "skycot/upload-this-branch-plain-git-52d1", defaultBranch: "main" },
          items: codexAsk(ESCALATION),
        },
        requestEvent(request("command")),
      );
      assert.equal(outcome.type, "held");
      assert.deepEqual(dispatched, []);
      if (outcome.type === "held") {
        assert.deepEqual(
          outcome.evaluation.matches.map((match) => match.rule.id),
          ["leaves-sandbox"],
        );
        assert.equal(outcome.evaluation.risk, "medium");
        assert.equal(outcome.evaluation.matches[0]!.detail, ESCALATION.reason);
      }
      // The same push asked for inside the sandbox (no reason) is still approved.
      const inside = yield* run(
        {
          thread: thread(
            "auto-accept-edits",
            "/work/site",
            "skycot/upload-this-branch-plain-git-52d1",
          ),
          git: { branch: "skycot/upload-this-branch-plain-git-52d1", defaultBranch: "main" },
          items: codexAsk(decodeCodexApproval({ ...ESCALATION, reason: null })),
        },
        requestEvent(request("command")),
      );
      assert.equal(inside.outcome.type, "approved");
    }),
  );

  it.effect("holds an escalation that also matches another rule as high", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        {
          items: codexAsk(
            decodeCodexApproval({ ...ESCALATION, command: "/bin/zsh -lc 'npx vercel --prod'" }),
          ),
        },
        requestEvent(request("command")),
      );
      assert.equal(outcome.type, "held");
      assert.deepEqual(dispatched, []);
      if (outcome.type === "held") {
        assert.equal(outcome.evaluation.risk, "high");
        assert.deepEqual(
          outcome.evaluation.matches.map((match) => match.rule.id),
          ["leaves-sandbox", "publishes-or-deploys"],
        );
      }
    }),
  );

  it.effect("lets Codex read its own skill instructions but never its sign-in file", () =>
    Effect.gen(function* () {
      const skill = yield* run(
        {
          items: [
            approvalItem("command"),
            commandItem(
              "/bin/zsh -lc 'cat /Users/me/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/vercel-cli/SKILL.md'",
            ),
          ],
        },
        requestEvent(request("command")),
      );
      assert.equal(skill.outcome.type, "approved");
      const auth = yield* run(
        {
          items: [
            approvalItem("command"),
            commandItem("/bin/zsh -lc 'cat /Users/me/.codex/auth.json'"),
          ],
        },
        requestEvent(request("command")),
      );
      assert.equal(auth.outcome.type, "held");
      if (auth.outcome.type === "held") {
        assert.ok(auth.outcome.evaluation.matches.some((match) => match.rule.id === "secrets"));
      }
    }),
  );
  describe("Family profile: safe steps run by themselves", () => {
    const RUN = "run-build" as RunId;
    const MESSAGE = "message:build-it";
    const AUTO = { stepRule: { type: "auto", childId: "c-ava" } } as const;
    /** A build turn ("Build it" on Sam's plan): the run whose message has the plan pass. */
    const buildTurn = (items: ReadonlyArray<OrchestrationV2TurnItem>) => ({
      family: AUTO,
      runs: { [RUN]: "running" as const },
      runMessages: { [RUN]: MESSAGE },
      items: items.map((item) =>
        item.type === "approval_request" ? { ...item, runId: RUN } : item,
      ),
      // Family threads are governed whatever mode they were made in.
      thread: thread("approval-required", "/work/site"),
    });
    const markBuild = SkycotFamilyInstructions.letRunWithoutPlan(MESSAGE, "builds-plan");

    it.effect("approves a safe step in a build turn without a card, in any thread mode", () =>
      Effect.gen(function* () {
        yield* markBuild;
        for (const command of ["ls -la", "node --check game.js", "pnpm test"]) {
          const { outcome, dispatched } = yield* run(
            buildTurn([approvalItem("command"), commandItem(command)]),
            requestEvent(request("command")),
          );
          assert.equal(outcome.type, "approved", command);
          assert.equal(dispatched.length, 1);
          assert.equal(dispatched[0]!.decision, "accept");
          assert.deepEqual(dispatched[0]!.answers, {
            skycot: { decidedBy: "policy", note: SKYCOT_POLICY_NOTE, ruleIds: [], version: 1 },
          });
          if (outcome.type === "approved") assert.equal(outcome.family?.needsGrownUp, false);
        }
        const edit = yield* run(
          {
            ...buildTurn([approvalItem("file-change", "update /work/site/index.html")]),
            request: request("file-change"),
          },
          requestEvent(request("file-change")),
        );
        assert.equal(edit.outcome.type, "approved");
        const fullAccess = yield* run(
          {
            ...buildTurn([approvalItem("command"), commandItem("ls")]),
            thread: thread("full-access", "/work/site"),
          },
          requestEvent(request("command")),
        );
        assert.equal(fullAccess.outcome.type, "approved");
      }),
    );

    it.effect("never approves a step that needs a grown-up (the safety test)", () =>
      Effect.gen(function* () {
        yield* markBuild;
        const roots = { projectRoot: "/work/site", projectFolder: "/projects/site" };
        // Steps only the Family rules hold: a reactor that judged by the hard rules alone would
        // approve these, so this test fails if the Family rules are ever skipped.
        const familyOnly = [
          "curl https://example.com/three.js -o three.js",
          "npm install three",
          "npx create-vite game",
          "pip install requests",
          "brew install ffmpeg",
          "sudo ls",
          "osascript -e 'beep'",
        ];
        for (const command of familyOnly) {
          assert.equal(
            evaluateRequest({ kind: "command", command }, roots).decision,
            "allow",
            `the hard rules alone allow: ${command}`,
          );
        }
        const holds = [...familyOnly, "rm -rf src", "git push origin main", "cat ~/.ssh/id_rsa"];
        for (const command of holds) {
          assert.equal(
            evaluateFamilyRequest({ kind: "command", command }, roots).needsGrownUp,
            true,
            command,
          );
          const { outcome, dispatched } = yield* run(
            buildTurn([approvalItem("command"), commandItem(command)]),
            requestEvent(request("command")),
          );
          assert.equal(outcome.type, "held", command);
          if (outcome.type === "held") assert.equal(outcome.family?.needsGrownUp, true, command);
          assert.deepEqual(dispatched, [], command);
        }
        // A web search is the internet whatever its words say.
        const search = yield* run(
          buildTurn([
            approvalItem("command", "cats"),
            {
              ...base,
              id: TurnItemId.make("turn-item:provider:codex:native-item:item-1"),
              ordinal: 0,
              status: "running",
              type: "web_search",
            } as unknown as OrchestrationV2TurnItem,
          ]),
          requestEvent(request("command")),
        );
        assert.equal(search.outcome.type, "held");
        assert.deepEqual(search.dispatched, []);
        // Outside the project, deleting files, connected apps.
        for (const [kind, prompt] of [
          ["file-change", "update /etc/hosts"],
          ["file-change", "delete /work/site/book.html"],
          ["file-read", "/Users/ava/Documents/diary.txt"],
          ["permission", "Use GitHub"],
        ] as const) {
          const { outcome, dispatched } = yield* run(
            { ...buildTurn([approvalItem(kind, prompt)]), request: request(kind) },
            requestEvent(request(kind)),
          );
          assert.equal(outcome.type, "held", prompt);
          assert.deepEqual(dispatched, [], prompt);
        }
      }),
    );

    it.effect("a project yes skips only its matching child, project and held kind", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const createdProjectPath = yield* fs.makeTempDirectory({
          prefix: "skycot-project-approval-",
        });
        const projectPath = yield* fs.realPath(createdProjectPath);
        const grant: SkycotFamily.ProjectApprovalGrant = {
          id: "grant-1",
          childId: "c-ava",
          projectPath,
          covers: ["internetFetch"],
          grantedBy: "grown-up",
          how: "parent-code",
          createdAt: 0,
          expiresAt: Number.MAX_SAFE_INTEGER,
        };
        const runHeld = (
          cwd: string,
          childId: string,
          covers: SkycotFamily.ProjectApprovalGrant["covers"],
        ) =>
          run(
            {
              family: AUTO,
              projectPath,
              projectGrants: [{ ...grant, childId, covers }],
              thread: thread("approval-required", cwd),
              items: [
                {
                  ...approvalItem("command", "curl https://example.com"),
                  nativeItemRef: { ...base.nativeItemRef, driver: CLAUDE },
                },
                {
                  ...commandItem("curl https://example.com"),
                  nativeItemRef: { ...base.nativeItemRef, driver: CLAUDE },
                },
              ],
            },
            { ...requestEvent(request("command")), driver: CLAUDE },
          );
        const matching = yield* runHeld(projectPath, "c-ava", ["internetFetch"]);
        assert.equal(matching.outcome.type, "approved");
        assert.equal(matching.dispatched.length, 1);
        const wrongChild = yield* runHeld(projectPath, "c-leo", ["internetFetch"]);
        assert.equal(wrongChild.outcome.type, "held");
        assert.equal(wrongChild.dispatched.length, 0);
        const uncovered = yield* runHeld(projectPath, "c-ava", ["webSearch"]);
        assert.equal(uncovered.outcome.type, "held");
        assert.equal(uncovered.dispatched.length, 0);
        const outside = yield* fs.makeTempDirectory({ prefix: "skycot-project-escape-" });
        const escaped = yield* runHeld(outside, "c-ava", ["internetFetch"]);
        assert.equal(escaped.outcome.type, "held");
        assert.equal(escaped.dispatched.length, 0);
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("runs the node:vm self-check only inside Codex's network-locked sandbox", () =>
      Effect.gen(function* () {
        yield* markBuild;
        const selfCheck =
          "node <<'NODE'\nconst vm = require('node:vm');\nvm.runInNewContext('1 + 1');\nNODE";
        const codex = yield* run(
          buildTurn([approvalItem("command", selfCheck), commandItem(selfCheck)]),
          requestEvent(request("command")),
        );
        assert.equal(codex.outcome.type, "approved");
        assert.equal(codex.dispatched[0]?.decision, "accept");

        const claudeApproval = {
          ...approvalItem("command", selfCheck),
          nativeItemRef: { ...base.nativeItemRef, driver: CLAUDE },
        };
        const claude = yield* run(
          buildTurn([claudeApproval, commandItem(selfCheck)]),
          requestEvent(request("command")),
        );
        assert.equal(claude.outcome.type, "held");
        assert.deepEqual(claude.dispatched, []);
      }),
    );

    it.effect("lets Codex try internet-only work inside its network-locked sandbox", () =>
      Effect.gen(function* () {
        yield* markBuild;
        const command = `node -e "fetch('https://example.com')"`;
        const codex = yield* run(
          buildTurn([approvalItem("command", command), commandItem(command)]),
          requestEvent(request("command")),
        );
        assert.equal(codex.outcome.type, "approved");
        assert.equal(codex.dispatched[0]?.decision, "accept");

        const claudeApproval = {
          ...approvalItem("command", command),
          nativeItemRef: { ...base.nativeItemRef, driver: CLAUDE },
        };
        const claude = yield* run(
          buildTurn([claudeApproval, commandItem(command)]),
          requestEvent(request("command")),
        );
        assert.equal(claude.outcome.type, "held");
        assert.deepEqual(claude.dispatched, []);
      }),
    );

    it.effect("never says the yes SKYCOT's own installer acts on (installs, downloads)", () =>
      Effect.gen(function* () {
        yield* markBuild;
        for (const command of [
          "npm install three",
          "npm i -D vite",
          "pnpm add three",
          "bun add three@0.160.0",
          "/bin/zsh -lc 'npm install three'",
          "curl -L -o three.module.js https://unpkg.com/three/build/three.module.js",
          "wget -O three.js https://example.com/three.js",
        ]) {
          // SkycotApprovedInstalls runs these itself, outside the sandbox, on a plain yes.
          assert.isTrue(
            parseApprovedInstall(command) !== null || parseApprovedDownload(command) !== null,
            `the installer takes: ${command}`,
          );
          const { outcome, dispatched } = yield* run(
            buildTurn([approvalItem("command"), commandItem(command)]),
            requestEvent(request("command")),
          );
          assert.equal(outcome.type, "held", command);
          assert.deepEqual(dispatched, [], command);
        }
      }),
    );

    it.effect("never runs an internet step Codex asked to take outside its sandbox", () =>
      Effect.sync(() => {
        const roots = { projectRoot: "/work/site", projectFolder: "/projects/site" };
        const command = `node -e "fetch('https://example.com')"`;
        const inside = { kind: "command", command } as const;
        const outside = {
          ...inside,
          leavesSandbox: true,
          sandboxReason: "Needs network access to fetch the page",
        } as const;
        const options = { codexNetworkLocked: true, command };
        // Inside the network-locked sandbox it may try (it simply can't reach the internet).
        assert.isTrue(
          SkycotPolicyReactor.mayAutoApprove(
            evaluateRequest(inside, roots),
            evaluateFamilyRequest(inside, roots),
            options,
          ),
        );
        // Escalated out of the sandbox, a yes would put it online: a grown-up decides.
        assert.isFalse(
          SkycotPolicyReactor.mayAutoApprove(
            evaluateRequest(outside, roots),
            evaluateFamilyRequest(outside, roots),
            options,
          ),
        );
      }),
    );

    it.effect("mayAutoApprove is false whenever a Family rule or a hard rule holds", () =>
      Effect.sync(() => {
        const roots = { projectRoot: "/work/site", projectFolder: "/projects/site" };
        const install = { kind: "command", command: "npm install three" } as const;
        const base = evaluateRequest(install, roots);
        assert.equal(base.decision, "allow");
        assert.equal(
          SkycotPolicyReactor.mayAutoApprove(base, evaluateFamilyRequest(install, roots)),
          false,
        );
        assert.equal(SkycotPolicyReactor.mayAutoApprove(base, undefined), true);
        const del = { kind: "command", command: "rm -rf src" } as const;
        assert.equal(
          SkycotPolicyReactor.mayAutoApprove(
            evaluateRequest(del, roots),
            evaluateFamilyRequest(del, roots),
          ),
          false,
        );
      }),
    );

    it.effect("asks the child again when their parent turned on Ask before each step", () =>
      Effect.gen(function* () {
        yield* markBuild;
        for (const reason of ["ask-each-step", "asleep", "no-child", "profile-off"] as const) {
          const { outcome, dispatched } = yield* run(
            {
              ...buildTurn([approvalItem("command"), commandItem("ls")]),
              family: { stepRule: { type: "ask", reason, childId: "c-ava" } },
            },
            requestEvent(request("command")),
          );
          assert.deepEqual(outcome, { type: "skipped", reason: `family: ${reason}` });
          assert.deepEqual(dispatched, []);
        }
      }),
    );

    it.effect("keeps Plan first: while planning, only looking around runs by itself", () =>
      Effect.gen(function* () {
        const planRun = "run-plan" as RunId;
        const planning = (items: ReadonlyArray<OrchestrationV2TurnItem>) => ({
          family: AUTO,
          runs: { [planRun]: "running" as const },
          runMessages: { [planRun]: "message:make-a-game" },
          items: items.map((item) =>
            item.type === "approval_request" ? { ...item, runId: planRun } : item,
          ),
        });
        for (const command of [
          "ls -la",
          "/bin/zsh -lc \"sed -n '1,80p' index.html\"",
          "rg score .",
        ]) {
          const looks = yield* run(
            planning([approvalItem("command"), commandItem(command)]),
            requestEvent(request("command")),
          );
          assert.equal(looks.outcome.type, "approved", command);
        }
        const read = yield* run(
          {
            ...planning([approvalItem("file-read", "/work/site/index.html")]),
            request: request("file-read"),
          },
          requestEvent(request("file-read")),
        );
        assert.equal(read.outcome.type, "approved");
        for (const command of ["echo hi > index.html", "pnpm test", "node build.js"]) {
          const changes = yield* run(
            planning([approvalItem("command"), commandItem(command)]),
            requestEvent(request("command")),
          );
          assert.deepEqual(
            changes.outcome,
            { type: "skipped", reason: "family: plan first (changes wait for Build it)" },
            command,
          );
          assert.deepEqual(changes.dispatched, []);
        }
        const edit = yield* run(
          {
            ...planning([approvalItem("file-change", "update /work/site/index.html")]),
            request: request("file-change"),
          },
          requestEvent(request("file-change")),
        );
        assert.equal(edit.outcome.type, "skipped");
        // A grown-up's step during a plan still waits for a grown-up.
        const install = yield* run(
          planning([approvalItem("command"), commandItem("npm install three")]),
          requestEvent(request("command")),
        );
        assert.equal(install.outcome.type, "held");
      }),
    );

    describe("beta 5: smoother Family", () => {
      const held = (outcome: SkycotPolicyReactor.SkycotPolicyOutcome) => outcome.type === "held";

      it.effect("a trusted add-on is accepted by the engine itself, never another", () =>
        Effect.gen(function* () {
          yield* markBuild;
          for (const command of [
            "npm install three",
            "/bin/zsh -lc 'pnpm add p5@1.9.0'",
            "curl -L -o vendor/three.module.js https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
            "wget -O confetti.js https://unpkg.com/canvas-confetti",
          ]) {
            const { outcome, dispatched } = yield* run(
              {
                ...buildTurn([approvalItem("command"), commandItem(command)]),
                trustedAddOns: true,
              },
              requestEvent(request("command")),
            );
            assert.equal(outcome.type, "approved", command);
            assert.equal(dispatched[0]?.decision, "accept", command);
            // SkycotApprovedInstalls reads this note and does the install itself.
            const note = (dispatched[0]?.answers as { skycot?: { relief?: string } } | undefined)
              ?.skycot;
            assert.equal(note?.relief, "trusted-add-on", command);
          }
          // Safety: an untrusted package, or a trusted name from another host, still waits.
          for (const command of [
            "npm install left-pad",
            "npm install three left-pad",
            "curl -L -o three.js https://example.com/three.js",
            "curl -L -o three.js https://cdn.jsdelivr.net/gh/mrdoob/three.js/build/three.module.js",
          ]) {
            const { outcome, dispatched } = yield* run(
              {
                ...buildTurn([approvalItem("command"), commandItem(command)]),
                trustedAddOns: true,
              },
              requestEvent(request("command")),
            );
            assert.isTrue(held(outcome), command);
            assert.deepEqual(dispatched, [], command);
          }
          // The parent's switch off: as before.
          const off = yield* run(
            {
              ...buildTurn([approvalItem("command"), commandItem("npm install three")]),
              trustedAddOns: false,
            },
            requestEvent(request("command")),
          );
          assert.isTrue(held(off.outcome));
          assert.deepEqual(off.dispatched, []);
        }),
      );

      it.effect("Ask before each step ON still asks the child, even for a trusted add-on", () =>
        Effect.gen(function* () {
          yield* markBuild;
          for (const command of ["ls", "npm install three", "rm -rf dist"]) {
            const { outcome, dispatched } = yield* run(
              {
                ...buildTurn([approvalItem("command"), commandItem(command)]),
                family: { stepRule: { type: "ask", reason: "ask-each-step", childId: "c-ava" } },
                trustedAddOns: true,
                checkpoints: [{ status: "ready" }],
              },
              requestEvent(request("command")),
            );
            assert.deepEqual(outcome, { type: "skipped", reason: "family: ask-each-step" });
            assert.deepEqual(dispatched, []);
          }
        }),
      );

      it.effect("one yes covers the same add-on in the same conversation only", () =>
        Effect.gen(function* () {
          yield* markBuild;
          // The engine's clock (the test clock here), as SkycotFamilyExtras reads it.
          const now = yield* Clock.currentTimeMillis;
          const remembered = withApproval(
            { version: 1, approvals: {}, added: [] },
            THREAD_ID,
            ["dayjs"],
            now,
          );
          const again = yield* run(
            {
              ...buildTurn([approvalItem("command"), commandItem("npm install dayjs@1.11.0")]),
              trustedAddOns: true,
              addOnFile: remembered,
            },
            requestEvent(request("command")),
          );
          assert.equal(again.outcome.type, "approved");
          const note = (
            again.dispatched[0]?.answers as { skycot?: { relief?: string } } | undefined
          )?.skycot;
          assert.equal(note?.relief, "approved-before");
          // Another package, a non-add-on command, or another conversation's yes: a grown-up.
          for (const [command, file] of [
            ["npm install lodash", remembered],
            ["npx dayjs", remembered],
            [
              "npm install dayjs",
              withApproval(
                { version: 1, approvals: {}, added: [] },
                "thread:other",
                ["dayjs"],
                now,
              ),
            ],
            [
              "npm install dayjs",
              withApproval(
                { version: 1, approvals: {}, added: [] },
                THREAD_ID,
                ["dayjs"],
                now - 8 * 24 * 60 * 60_000,
              ),
            ],
          ] as const) {
            const { outcome, dispatched } = yield* run(
              {
                ...buildTurn([approvalItem("command"), commandItem(command)]),
                trustedAddOns: true,
                addOnFile: file,
              },
              requestEvent(request("command")),
            );
            assert.isTrue(held(outcome), command);
            assert.deepEqual(dispatched, [], command);
          }
        }),
      );

      it.effect("a delete inside the project runs by itself only when it can be undone", () =>
        Effect.gen(function* () {
          yield* markBuild;
          const versions = { checkpoints: [{ status: "ready" }] };
          for (const command of ["rm -rf dist", "rm old.html", "rm -r /work/site/levels/old"]) {
            const { outcome, dispatched } = yield* run(
              { ...buildTurn([approvalItem("command"), commandItem(command)]), ...versions },
              requestEvent(request("command")),
            );
            assert.equal(outcome.type, "approved", command);
            const note = (dispatched[0]?.answers as { skycot?: { relief?: string } } | undefined)
              ?.skycot;
            assert.equal(note?.relief, "undoable-delete", command);
          }
          // Safety: .git, the project root, outside, home, wildcards, or no versions.
          for (const [command, scenario] of [
            ["rm -rf .git", versions],
            ["rm -rf /work/site", versions],
            ["rm -rf .", versions],
            ["rm -rf ../x", versions],
            ["rm -rf ~/x", versions],
            ["rm -rf src/*", versions],
            ["find . -delete", versions],
            ["ls | xargs rm", versions],
            ["rm -rf dist", { checkpoints: [] }],
            ["rm -rf dist", { checkpoints: [{ status: "missing" }] }],
          ] as const) {
            const { outcome, dispatched } = yield* run(
              { ...buildTurn([approvalItem("command"), commandItem(command)]), ...scenario },
              requestEvent(request("command")),
            );
            assert.isTrue(held(outcome), command);
            assert.deepEqual(dispatched, [], command);
          }
        }),
      );
    });

    it.effect("with the profile off, a Family-style thread is not governed (unchanged)", () =>
      Effect.gen(function* () {
        yield* markBuild;
        const { outcome, dispatched } = yield* run(
          { ...buildTurn([approvalItem("command"), commandItem("ls")]), family: false },
          requestEvent(request("command")),
        );
        assert.deepEqual(outcome, { type: "skipped", reason: "runtime mode not governed" });
        assert.deepEqual(dispatched, []);
      }),
    );
  });
});
