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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as CodexSchema from "effect-codex-app-server/schema";

import { SKYCOT_POLICY_NOTE } from "@t3tools/skycot-rules/decision";
import { UNKNOWN_BRANCH_PUSH } from "@t3tools/skycot-rules/rules";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { GitCommandError } from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as SkycotPolicyReactor from "./SkycotPolicyReactor.ts";

const CODEX = ProviderDriverKind.make("codex");
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
    const layerDependencies = Layer.mergeAll(
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
              .map(([id, status]) => ({ id, status }) as unknown as OrchestrationV2Run),
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
              workspaceRoot: "/projects/site",
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
});
