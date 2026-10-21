import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type RuntimeMode,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as SkycotPolicy from "./SkycotPolicy.ts";

const CODEX = ProviderDriverKind.make("codex");
const projectId = ProjectId.make("project:skycot");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(runtimeMode: RuntimeMode, now: DateTime.Utc): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:skycot");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Skycot",
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    runtimeMode,
    interactionMode: "default",
    branch: null,
    worktreePath: "/work/site",
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

/** A base policy that passes the thread's own mode straight through. */
const layerBase = Layer.succeed(RuntimePolicy.RuntimePolicyV2, {
  resolve: (input) =>
    Effect.succeed(
      ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: input.thread.runtimeMode,
        interactionMode: input.thread.interactionMode,
        cwd: input.thread.worktreePath,
      }),
    ),
});

const resolveWith = (enabled: boolean, runtimeMode: RuntimeMode) =>
  Effect.gen(function* () {
    const policy = yield* RuntimePolicy.RuntimePolicyV2;
    const now = yield* DateTime.now;
    return yield* policy.resolve({ thread: makeThread(runtimeMode, now), modelSelection });
  }).pipe(
    Effect.provide(SkycotPolicy.layerRuntimePolicy({ enabled }).pipe(Layer.provide(layerBase))),
  );

describe("SkycotPolicy.layerRuntimePolicy", () => {
  it.effect("makes the provider ask for everything only in auto-accept-edits", () =>
    Effect.gen(function* () {
      const careful = yield* resolveWith(true, "auto-accept-edits");
      assert.equal(careful.runtimeMode, "auto-accept-edits");
      assert.equal(careful.approvalPolicy, "untrusted");
      assert.deepEqual(careful.sandboxPolicy, { type: "workspaceWrite" });
      assert.equal(careful.cwd, "/work/site");

      for (const mode of ["approval-required", "auto", "full-access"] as const) {
        const untouched = yield* resolveWith(true, mode);
        assert.equal(untouched.runtimeMode, mode);
        assert.equal(untouched.approvalPolicy, undefined);
        assert.equal(untouched.sandboxPolicy, undefined);
      }
    }),
  );

  it.effect("is the identity when the flag is off", () =>
    Effect.gen(function* () {
      const policy = yield* resolveWith(false, "auto-accept-edits");
      assert.equal(policy.approvalPolicy, undefined);
      assert.equal(policy.sandboxPolicy, undefined);
    }),
  );

  it("reads the flag from the environment", () => {
    assert.equal(SkycotPolicy.isSkycotPolicyEnabled({ T3CODE_SKYCOT_POLICY: "1" }), true);
    assert.equal(SkycotPolicy.isSkycotPolicyEnabled({ T3CODE_SKYCOT_POLICY: "true" }), false);
    assert.equal(SkycotPolicy.isSkycotPolicyEnabled({}), false);
  });
});

const now = DateTime.makeUnsafe("2026-10-21T09:00:00.000Z");

function approval(
  requestKind: "command" | "file-change" | "file-read" | "permission",
  prompt: string | undefined,
): Extract<OrchestrationV2TurnItem, { type: "approval_request" }> {
  return {
    id: TurnItemId.make("turn-item:approval"),
    threadId: ThreadId.make("thread:skycot"),
    runId: null,
    nodeId: "node:approval" as never,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: { driver: CODEX, nativeId: "item-1", strength: "strong" },
    parentItemId: null,
    ordinal: 1,
    status: "waiting",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    type: "approval_request",
    requestId: RuntimeRequestId.make("req-1"),
    requestKind,
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function commandItem(input: string): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("turn-item:cmd"),
    threadId: ThreadId.make("thread:skycot"),
    runId: null,
    nodeId: "node:cmd" as never,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: { driver: CODEX, nativeId: "item-1", strength: "strong" },
    parentItemId: null,
    ordinal: 0,
    status: "running",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    type: "command_execution",
    input,
  };
}

function fileItem(fileName: string): OrchestrationV2TurnItem {
  return { ...commandItem(""), type: "file_change", fileName } as OrchestrationV2TurnItem;
}

describe("SkycotPolicy.requestFacts", () => {
  it("prefers the exact command over the provider's title", () => {
    assert.deepEqual(
      SkycotPolicy.requestFacts(
        approval("command", "Remove the old page"),
        commandItem("rm book.html"),
      ),
      { kind: "command", command: "rm book.html" },
    );
    assert.deepEqual(SkycotPolicy.requestFacts(approval("command", "rm book.html"), null), {
      kind: "command",
      command: "rm book.html",
    });
    assert.deepEqual(SkycotPolicy.requestFacts(approval("command", undefined), null), {
      kind: "command",
      command: undefined,
    });
  });

  it("joins the files the prompt names with the tool call's path", () => {
    assert.deepEqual(
      SkycotPolicy.requestFacts(
        approval("file-change", "delete /work/site/book.html"),
        fileItem("/work/site/book.html"),
      ),
      { kind: "file-change", files: [{ path: "/work/site/book.html", operation: "remove" }] },
    );
    assert.deepEqual(
      SkycotPolicy.requestFacts(
        approval("file-change", "Edit the booking page"),
        fileItem("/work/site/book.html"),
      ),
      { kind: "file-change", files: [{ path: "/work/site/book.html", operation: "change" }] },
    );
    assert.deepEqual(SkycotPolicy.requestFacts(approval("file-read", "/etc/hosts"), null), {
      kind: "file-read",
      files: [{ path: "/etc/hosts", operation: "change" }],
    });
    assert.deepEqual(SkycotPolicy.requestFacts(approval("file-change", undefined), null), {
      kind: "file-change",
      files: [],
    });
  });

  it("passes connected-app requests through by kind", () => {
    assert.deepEqual(SkycotPolicy.requestFacts(approval("permission", "Use GitHub"), null), {
      kind: "permission",
    });
  });
});
