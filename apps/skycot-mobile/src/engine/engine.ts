// nondev-seam: skycot-iphone-q47-question-answer
/**
 * What the app reads from and asks of a Mac's engine, in T3's own shapes.
 *
 * Reads are plain requests (`/api/orchestration/shell`, `/api/orchestration/threads/:id`), which
 * the engine already filters per device: a child's device only ever receives its own
 * conversations and projects (WHO-IS-WHO, "Visibility is the engine's"). This app never filters
 * on its own. Commands go over the engine's RPC channel with the same command shapes the plain
 * client sends (client-runtime/src/operations/commands.ts).
 */
import {
  CheckpointId,
  CheckpointScopeId,
  CommandId,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  PlanId,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
  WS_METHODS,
  isProviderAvailable,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { MacTransport } from "../transport/MacTransport";
import { withMacRpc } from "../transport/rpc";
import { newId } from "./ids";
import { SAMPLE_NEW_CONVERSATION, SAMPLE_PROVIDER } from "../sample/fixtures";
import type { ShellSnapshot, ThreadProjection } from "./types";

// The sample family (src/sample) has no command channel: its reads are plain requests, answered
// from fixtures, and every command below ends in a harmless local acknowledgement.
const inSample = (transport: MacTransport): boolean => transport.kind === "sample";

export class EngineError extends Error {
  override readonly name = "EngineError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function engineMessage(json: unknown, fallback: string): string {
  const body = record(json);
  if (typeof body.message === "string" && body.message.length > 0) return body.message;
  return fallback;
}

export async function readShell(transport: MacTransport): Promise<ShellSnapshot> {
  const answer = await transport.request({ method: "GET", path: "/api/orchestration/shell" });
  if (answer.status !== 200) {
    throw new EngineError(answer.status, engineMessage(answer.json, "The list didn't load."));
  }
  return answer.json as ShellSnapshot;
}

export async function readThread(
  transport: MacTransport,
  threadId: string,
): Promise<ThreadProjection> {
  const answer = await transport.request({
    method: "GET",
    path: `/api/orchestration/threads/${encodeURIComponent(threadId)}`,
  });
  if (answer.status !== 200) {
    throw new EngineError(
      answer.status,
      engineMessage(answer.json, "The conversation didn't load."),
    );
  }
  return record(answer.json).projection as ThreadProjection;
}

function usable(providers: ReadonlyArray<ServerProvider>): Array<ServerProvider> {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.models.length > 0,
  );
}

/**
 * The model a new conversation starts with, as the plain client picks it
 * (apps/nondev/src/state/providers.ts): the project's default when usable, else the first
 * usable assistant's default model. Null: nothing on the Mac can run yet.
 */
export function defaultModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  projectDefault: ModelSelection | null,
): ModelSelection | null {
  const choices = usable(providers);
  if (projectDefault !== null) {
    const owner = choices.find((provider) => provider.instanceId === projectDefault.instanceId);
    if (owner?.models.some((model) => model.slug === projectDefault.model)) return projectDefault;
  }
  const provider = choices[0];
  if (provider === undefined) return null;
  const model = provider.models.find((entry) => entry.isDefault) ?? provider.models[0]!;
  return { instanceId: provider.instanceId, model: model.slug };
}

export interface MacConfig {
  readonly providers: ReadonlyArray<ServerProvider>;
  /** Where Just ask's Questions live on the Mac; its project is shown as "Questions". */
  readonly questionsRoot: string | null;
}

export function readMacConfig(transport: MacTransport): Promise<MacConfig> {
  if (inSample(transport)) {
    return Promise.resolve({ providers: [SAMPLE_PROVIDER], questionsRoot: null });
  }
  return withMacRpc(transport, (client) =>
    client[WS_METHODS.serverGetConfig]({}).pipe(
      Effect.map((config) => ({
        providers: config.providers,
        questionsRoot: config.scratchWorkspaceRoot ?? null,
      })),
    ),
  );
}

export function readProviders(transport: MacTransport): Promise<ReadonlyArray<ServerProvider>> {
  return readMacConfig(transport).then((config) => config.providers);
}

const command = () => CommandId.make(newId());

/** Just ask: the engine's Questions space (made on first use); each question gets its own folder. */
export function openQuestions(transport: MacTransport): Promise<{ readonly projectId: string }> {
  if (inSample(transport)) return Promise.resolve({ projectId: "sample-project-questions" });
  return withMacRpc(transport, (client) =>
    client[WS_METHODS.projectsEnsureScratch]({}).pipe(
      Effect.map((result) => ({ projectId: String(result.projectId) })),
    ),
  );
}

export interface StartConversationInput {
  readonly projectId: string;
  readonly title: string;
  readonly text: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/** A new conversation in a project, with its first message (the plain client's launch). */
export function startConversation(
  transport: MacTransport,
  input: StartConversationInput,
): Promise<{ readonly threadId: string }> {
  if (inSample(transport)) return Promise.resolve({ threadId: SAMPLE_NEW_CONVERSATION });
  const threadId = ThreadId.make(newId());
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.launchThread]({
      commandId: command(),
      creationSource: "mobile",
      threadId,
      projectId: ProjectId.make(input.projectId),
      title: input.title,
      generateTitle: true,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      workspaceStrategy: { type: "root" },
      initialMessage: { messageId: MessageId.make(newId()), text: input.text, attachments: [] },
    }).pipe(Effect.map((result) => ({ threadId: String(result.threadId) }))),
  );
}

/** A reply in a conversation; `plan` builds a plan the engine still holds ("Build it"). */
export function sendMessage(
  transport: MacTransport,
  input: {
    readonly threadId: string;
    readonly text: string;
    readonly plan?: { readonly planId: string };
  },
): Promise<unknown> {
  if (inSample(transport)) return Promise.resolve(null);
  const threadId = ThreadId.make(input.threadId);
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "message.dispatch",
      commandId: command(),
      createdBy: "user",
      creationSource: "mobile",
      threadId,
      messageId: MessageId.make(newId()),
      text: input.text,
      attachments: [],
      ...(input.plan === undefined
        ? {}
        : { sourcePlanRef: { threadId, planId: PlanId.make(input.plan.planId) } }),
      deliveryIntent: "auto",
      dispatchMode: { type: "start_immediately" },
    }),
  );
}

export function respondToRequest(
  transport: MacTransport,
  input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly decision: Extract<ProviderApprovalDecision, "accept" | "decline" | "cancel">;
  },
): Promise<unknown> {
  if (inSample(transport)) return Promise.resolve(null);
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "runtime-request.respond",
      commandId: command(),
      threadId: ThreadId.make(input.threadId),
      requestId: RuntimeRequestId.make(input.requestId),
      decision: input.decision,
    }),
  );
}

export function answerQuestion(
  transport: MacTransport,
  input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: Readonly<Record<string, string>>;
  },
): Promise<unknown> {
  if (inSample(transport)) return Promise.resolve(null);
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "runtime-request.respond",
      commandId: command(),
      threadId: ThreadId.make(input.threadId),
      requestId: RuntimeRequestId.make(input.requestId),
      answers: input.answers,
    }),
  );
}

/** Undo: back to the restore point from before a change (files and conversation). */
export function undoTo(
  transport: MacTransport,
  input: { readonly threadId: string; readonly scopeId: string; readonly checkpointId: string },
): Promise<unknown> {
  if (inSample(transport)) return Promise.resolve(null);
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "checkpoint.rollback",
      restoreFiles: true,
      commandId: command(),
      threadId: ThreadId.make(input.threadId),
      scopeId: CheckpointScopeId.make(input.scopeId),
      checkpointId: CheckpointId.make(input.checkpointId),
    }),
  );
}

export function stopConversation(transport: MacTransport, threadId: string): Promise<unknown> {
  if (inSample(transport)) return Promise.resolve(null);
  return withMacRpc(transport, (client) =>
    client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "thread.stop",
      commandId: command(),
      threadId: ThreadId.make(threadId),
    }),
  );
}
