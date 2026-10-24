// Provider snapshots and runs for the model fallback's tests: Claude with its account windows
// and Fable's own weekly window, ChatGPT (Codex), and a provider nobody signed in to.
import type {
  ModelSelection,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ServerProvider,
  ServerProviderModel,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const NOW = Date.parse("2026-10-24T09:00:00Z");
export const HOUR = 60 * 60_000;
export const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
export const FABLE_RESET = NOW + 66 * HOUR;

const model = (
  slug: string,
  name: string,
  extra: Partial<ServerProviderModel> = {},
): ServerProviderModel => ({ slug, name, isCustom: false, capabilities: null, ...extra });

export const CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  model("claude-opus-5-5", "Claude Opus 5.5", { aliases: ["opus"] }),
  model("claude-sonnet-5-5", "Claude Sonnet 5.5", { aliases: ["sonnet"] }),
  model("claude-fable-5-1", "Claude Fable 5.1", { aliases: ["fable"], isDefault: true }),
  model("claude-fable-5", "Claude Fable 5", { isLegacy: true }),
  model("claude-haiku-5-5", "Claude Haiku 5.5", { aliases: ["haiku"] }),
  model("my-claude", "My Claude", { isCustom: true }),
];

export const CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  model("gpt-6.1-sol", "GPT-6.1 Sol"),
  model("gpt-6-astra", "GPT-6 Astra", { isDefault: true }),
  model("gpt-5.5", "GPT-5.5", { isLegacy: true }),
];

export const window = (
  id: string,
  label: string,
  usedPercent: number,
  resetsAt: number | null,
): ServerProviderUsageWindow => ({
  id,
  kind: id === "five_hour" || id === "primary" ? "session" : "weekly",
  label,
  usedPercent,
  ...(resetsAt === null ? {} : { resetsAt: iso(resetsAt) }),
});

/** Mark's Mac on 24 October 2026: Claude at 85% for the week, Fable's own week spent. */
export const FABLE_OUT: ReadonlyArray<ServerProviderUsageWindow> = [
  window("five_hour", "Session", 20, NOW + 3 * HOUR),
  window("seven_day", "Weekly", 85, NOW + 70 * HOUR),
  window("seven_day_fable", "Weekly · Fable", 100, FABLE_RESET),
];

export const CLAUDE_ACCOUNT_OUT: ReadonlyArray<ServerProviderUsageWindow> = [
  window("five_hour", "Session", 100, NOW + 2 * HOUR),
  window("seven_day", "Weekly", 85, NOW + 70 * HOUR),
];

export function provider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly windows?: ReadonlyArray<ServerProviderUsageWindow>;
  readonly signedIn?: boolean;
  readonly enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: input.driver,
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: input.signedIn === false ? "unauthenticated" : "authenticated" },
    checkedAt: iso(NOW),
    models: input.models,
    slashCommands: [],
    skills: [],
    ...(input.windows === undefined
      ? {}
      : { usageLimits: { checkedAt: iso(NOW), windows: input.windows } }),
  } as unknown as ServerProvider;
}

export const claude = (windows: ReadonlyArray<ServerProviderUsageWindow> = FABLE_OUT) =>
  provider({ instanceId: "claudeAgent", driver: "claudeAgent", models: CLAUDE_MODELS, windows });

export const codex = (
  windows: ReadonlyArray<ServerProviderUsageWindow> = [
    window("primary", "Session", 10, NOW + 4 * HOUR),
  ],
  extra: { readonly signedIn?: boolean; readonly enabled?: boolean } = {},
) => provider({ instanceId: "codex", driver: "codex", models: CODEX_MODELS, windows, ...extra });

/** Installed and switched on, never signed in. */
export const cursor = () =>
  provider({
    instanceId: "cursor",
    driver: "cursor",
    models: [model("cursor-auto", "Auto")],
    windows: [],
    signedIn: false,
  });

export const selection = (instanceId: string, model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

const at = (ms: number) => DateTime.makeUnsafe(ms);

export function run(input: {
  readonly id: string;
  readonly ordinal: number;
  readonly modelSelection: ModelSelection;
  readonly status?: OrchestrationV2Run["status"];
  readonly userMessageId?: string;
  readonly completedAt?: number;
}): OrchestrationV2Run {
  return {
    id: input.id,
    threadId: "thread-1",
    ordinal: input.ordinal,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    providerThreadId: `provider-thread-${input.id}`,
    userMessageId: input.userMessageId ?? `message-${input.id}`,
    rootNodeId: `node-${input.id}`,
    activeAttemptId: `attempt-${input.id}`,
    status: input.status ?? "failed",
    queuePosition: null,
    requestedAt: at(NOW - HOUR + input.ordinal),
    startedAt: at(NOW - HOUR + input.ordinal),
    completedAt: at(input.completedAt ?? NOW - HOUR + input.ordinal * 1000),
    checkpointId: null,
    contextHandoffId: null,
  } as unknown as OrchestrationV2Run;
}

export function usageLimitError(
  forRun: OrchestrationV2Run,
  resetAt: number | null,
  failureClass: "usage_limit" | "provider_error" = "usage_limit",
): OrchestrationV2TurnItem {
  return {
    id: `error-${forRun.id}`,
    threadId: "thread-1",
    runId: forRun.id,
    nodeId: forRun.rootNodeId,
    type: "error",
    status: "failed",
    ordinal: 9,
    updatedAt: forRun.completedAt,
    failure: {
      class: failureClass,
      message: "Claude usage limit reached.",
      ...(resetAt === null ? {} : { resetAt: iso(resetAt) }),
    },
  } as unknown as OrchestrationV2TurnItem;
}

export function projection(input: {
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly messageIds?: ReadonlyArray<string>;
  readonly modelSelection?: ModelSelection;
}): OrchestrationV2ThreadProjection {
  return {
    thread: {
      id: "thread-1",
      modelSelection: input.modelSelection ?? input.runs.at(-1)!.modelSelection,
      providerInstanceId: (input.modelSelection ?? input.runs.at(-1)!.modelSelection).instanceId,
      archivedAt: null,
      deletedAt: null,
      settledOverride: null,
      snoozedUntil: null,
    },
    runs: input.runs,
    turnItems: input.turnItems,
    messages: (input.messageIds ?? []).map((id) => ({ id })),
    runtimeRequests: [],
  } as unknown as OrchestrationV2ThreadProjection;
}
