import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
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
import * as Stream from "effect/Stream";

import { SKYCOT_POLICY_NOTE } from "@t3tools/skycot-rules/decision";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SkycotPolicyReactor from "./SkycotPolicyReactor.ts";

const CODEX = ProviderDriverKind.make("codex");
const NOW = DateTime.makeUnsafe("2026-10-21T09:00:00.000Z");
const THREAD_ID = ThreadId.make("thread:skycot");
const PROJECT_ID = ProjectId.make("project:skycot");
const REQUEST_ID = RuntimeRequestId.make("req-1");
const SESSION_ID = ProviderSessionId.make("session-1");
type RespondCommand = Extract<OrchestrationV2Command, { readonly type: "runtime-request.respond" }>;

function thread(runtimeMode: RuntimeMode, worktreePath: string | null): OrchestrationV2AppThread {
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
    branch: null,
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
}

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
        { items: [approvalItem("command", "Run the checks"), commandItem("pnpm test")] },
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

  it.effect("holds a delete even when the provider's title hides it", () =>
    Effect.gen(function* () {
      const { outcome, dispatched } = yield* run(
        { items: [approvalItem("command", "Tidy up the old page"), commandItem("rm book.html")] },
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
});
