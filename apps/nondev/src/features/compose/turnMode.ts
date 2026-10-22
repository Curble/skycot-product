// A follow-up message starts its turn in the conversation's stored interaction mode: the engine's
// `message.dispatch` carries no mode of its own (the stock client sets the thread's mode first,
// too). So a request sent with plan first on, or a "Build it", switches the conversation's mode
// before it starts, and only when it differs.
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInteractionMode, ThreadId } from "@t3tools/contracts";

import { useAtomCommand } from "~/state/use-atom-command";

import { threadEnvironment } from "../../state/threads";

export type EnsureMode = (input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly current: ProviderInteractionMode;
  readonly wanted: ProviderInteractionMode;
}) => Promise<unknown | null>;

/** Resolves to null once the conversation is in `wanted`, or to the failure's cause. */
export function useEnsureInteractionMode(): EnsureMode {
  const setMode = useAtomCommand(threadEnvironment.setInteractionMode, { reportFailure: false });
  return async ({ environmentId, threadId, current, wanted }) => {
    if (current === wanted) return null;
    const result = await setMode({ environmentId, input: { threadId, interactionMode: wanted } });
    return result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  };
}
