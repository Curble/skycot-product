/**
 * The engine's answers as they arrive over plain requests: JSON, so the `Encoded` side of T3's
 * schemas (dates are ISO strings). The screens read only these.
 */
import type {
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

type Encoded<T extends Schema.Top> = T["Encoded"];

export type ShellSnapshot = Encoded<typeof OrchestrationV2ShellSnapshot>;
export type ThreadShell = Encoded<typeof OrchestrationV2ThreadShell>;
export type ProjectShell = Encoded<typeof OrchestrationProjectShell>;
export type ThreadProjection = Encoded<typeof OrchestrationV2ThreadProjection>;
export type ConversationMessage = ThreadProjection["messages"][number];
export type PlanArtifact = ThreadProjection["plans"][number];
export type RuntimeRequest = ThreadProjection["runtimeRequests"][number];
export type Checkpoint = ThreadProjection["checkpoints"][number];
export type TurnItem = ThreadProjection["turnItems"][number];
