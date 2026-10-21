// Fixtures are decoded through the real contract schemas so a drifted field name fails loudly
// here instead of silently in the UI. Not a test file: the `.test-helpers.ts` suffix keeps it
// out of the runner while the plain tests import it.
import {
  GitRunStackedActionResult,
  OrchestrationV2CheckpointJson,
  OrchestrationV2RuntimeRequestJson,
  OrchestrationV2TurnItemJson,
  ProviderOptionDescriptor,
  ThreadPullRequestSnapshot,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const NOW_ISO = "2026-10-21T09:30:00.000Z";

const decodeTurnItem = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);
const decodeCheckpoint = Schema.decodeUnknownSync(OrchestrationV2CheckpointJson);
const decodeRuntimeRequest = Schema.decodeUnknownSync(OrchestrationV2RuntimeRequestJson);
export const decodePullRequestSnapshot = Schema.decodeUnknownSync(ThreadPullRequestSnapshot);
export const decodeStackedResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
export const decodeOptionDescriptor = Schema.decodeUnknownSync(ProviderOptionDescriptor);

let ordinal = 0;

export function turnItem<Type extends OrchestrationV2TurnItem["type"]>(
  type: Type,
  fields: Record<string, unknown>,
  base: Record<string, unknown> = {},
): Extract<OrchestrationV2TurnItem, { readonly type: Type }> {
  ordinal += 1;
  return decodeTurnItem({
    id: `item-${ordinal}`,
    type,
    threadId: "thread-1",
    runId: "run-1",
    nodeId: "node-1",
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: NOW_ISO,
    ...base,
    ...fields,
  }) as Extract<OrchestrationV2TurnItem, { readonly type: Type }>;
}

export const items = {
  command: (
    input: string,
    extra: Record<string, unknown> = {},
    base: Record<string, unknown> = {},
  ) => turnItem("command_execution", { input, ...extra }, base),
  fileChange: (
    fileName: string,
    extra: Record<string, unknown> = {},
    base: Record<string, unknown> = {},
  ) => turnItem("file_change", { fileName, ...extra }, base),
  assistant: (text: string, streaming = false) =>
    turnItem("assistant_message", { messageId: "msg-1", text, streaming }),
  user: (text: string) =>
    turnItem("user_message", {
      messageId: "msg-0",
      inputIntent: "turn_start",
      text,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    }),
  reasoning: (text: string, streaming = false) => turnItem("reasoning", { text, streaming }),
  approval: (
    requestKind: "command" | "file-read" | "file-change" | "mcp-elicitation" | "permission",
    extra: Record<string, unknown> = {},
    base: Record<string, unknown> = {},
  ) =>
    turnItem(
      "approval_request",
      { requestId: "req-1", requestKind, ...extra },
      { status: "waiting", ...base },
    ),
  question: (extra: Record<string, unknown> = {}, base: Record<string, unknown> = {}) =>
    turnItem(
      "user_input_request",
      {
        requestId: "req-q",
        questions: [
          {
            id: "q1",
            header: "Colour",
            question: "Which colour should the button be?",
            options: [
              { label: "Blue", description: "Matches the header" },
              { label: "Green", description: "Stands out more" },
            ],
          },
        ],
        ...extra,
      },
      { status: "waiting", ...base },
    ),
  secret: (secretStatus: "pending" | "saved" | "declined" | "cancelled" = "pending") =>
    turnItem("secret_request", {
      label: "Stripe API key",
      reason: "To create the checkout page.",
      secretStatus,
    }),
  plan: (markdown: string, streaming = false) =>
    turnItem("proposed_plan", { planId: "plan-1", markdown, streaming }),
  todo: (steps: ReadonlyArray<{ text: string; status: "pending" | "running" | "completed" }>) =>
    turnItem(
      "todo_list",
      { planId: "plan-1", steps: steps.map((s, i) => ({ id: `s${i}`, ...s })) },
      { status: "running" },
    ),
  fileSearch: (pattern: string, results: number) =>
    turnItem("file_search", {
      pattern,
      results: Array.from({ length: results }, (_, i) => ({ fileName: `src/f${i}.ts` })),
    }),
  webSearch: (query: string, titles: ReadonlyArray<string>) =>
    turnItem("web_search", {
      patterns: [query],
      results: titles.map((title) => ({ title, url: "https://example.com" })),
    }),
  checkpoint: (
    files: ReadonlyArray<{ path: string; kind: string; additions: number; deletions: number }>,
  ) => turnItem("checkpoint", { checkpointId: "ckpt-1", scopeId: "scope-1", files }),
  error: (failure: Record<string, unknown>, retry?: Record<string, unknown>) =>
    turnItem(
      "error",
      { failure: { code: null, retryable: null, ...failure }, ...(retry ? { retry } : {}) },
      { status: "failed" },
    ),
  dynamicTool: (toolName: string, input: unknown, base: Record<string, unknown> = {}) =>
    turnItem("dynamic_tool", { toolName, input }, base),
  subagent: (prompt: string, result: string | null = null, base: Record<string, unknown> = {}) =>
    turnItem(
      "subagent",
      {
        subagentId: "node-sub",
        origin: "app_owned",
        driver: "codex",
        providerInstanceId: "codex",
        childThreadId: null,
        prompt,
        result,
      },
      base,
    ),
  compaction: () =>
    turnItem("compaction", { driver: "codex", beforeTokenCount: 120000, afterTokenCount: 30000 }),
  handoff: () =>
    turnItem("handoff", {
      contextHandoffId: "handoff-1",
      fromProviderThreadIds: ["pt-1"],
      toProviderThreadId: "pt-2",
      fromProviderInstanceIds: ["codex"],
      toProviderInstanceId: "claude",
      toModel: "Claude",
      strategy: "full_thread_summary",
    }),
  notice: (message: string) => turnItem("system_notice", { message }),
  interruptRequest: () => turnItem("run_interrupt_request", { message: "Stop" }),
  interruptResult: () => turnItem("run_interrupt_result", { message: "Stopped" }),
  // `fork` redeclares providerThreadId as optional (no null), unlike every other item.
  fork: () =>
    turnItem("fork", {
      source: { type: "node", nodeId: "node-1" },
      targetThreadId: "thread-2",
      providerThreadId: undefined,
    }),
  threadCreated: () =>
    turnItem("thread_created", {
      targetThreadId: "thread-3",
      targetRunId: null,
      targetProviderInstanceId: "codex",
      targetModel: "gpt-6-astra",
    }),
};

export function checkpoint(fields: Record<string, unknown> = {}): OrchestrationV2Checkpoint {
  return decodeCheckpoint({
    id: "ckpt-1",
    threadId: "thread-1",
    scopeId: "scope-root",
    runId: "run-1",
    nodeId: "node-1",
    parentCheckpointId: null,
    ordinalWithinScope: 1,
    appRunOrdinal: 1,
    ref: "refs/t3/checkpoints/ckpt-1",
    status: "ready",
    files: [{ path: "src/pages/booking.tsx", kind: "modified", additions: 12, deletions: 3 }],
    capturedAt: NOW_ISO,
    ...fields,
  });
}

export function runtimeRequest(
  fields: Record<string, unknown> = {},
): OrchestrationV2RuntimeRequest {
  return decodeRuntimeRequest({
    id: "req-raw",
    nodeId: "node-1",
    providerTurnId: null,
    nativeRequestRef: null,
    kind: "command",
    status: "pending",
    responseCapability: { type: "live", providerSessionId: "session-1" },
    createdAt: NOW_ISO,
    resolvedAt: null,
    ...fields,
  });
}

export function pullRequest(fields: Record<string, unknown> = {}) {
  return decodePullRequestSnapshot({
    state: "open",
    title: "Add booking page",
    headBranch: "t3/booking-page",
    baseBranch: "main",
    isDraft: false,
    updatedAt: NOW_ISO,
    syncedAt: NOW_ISO,
    ...fields,
  });
}
