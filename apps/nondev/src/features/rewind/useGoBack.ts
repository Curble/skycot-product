import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  type EnvironmentId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { serverEnvironment } from "../../state/server";
import { canOperateEnvironmentAtom } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { plainRestoreProblem } from "../versions/RestoreSheet";
import { canRollbackFilesFor, useVersionsTimeline } from "../versions/timeline";
import {
  filesChoice,
  rewindCheck,
  rewindProgress,
  type FilesChoice,
  type RewindCheck,
  type RewindTarget,
} from "./rewind";

type UserMessage = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;

/** Long enough for a big project's files; the engine's own rollback has no deadline. */
const GO_BACK_TIMEOUT_MS = 120_000;

/** The facts every "can I go back?" question needs, read once per conversation. */
export function useRewindFacts(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly archived: boolean;
}) {
  const { environmentId, threadId, shell, projection, archived } = input;
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const provider =
    shell === null
      ? undefined
      : providers?.find((candidate) => candidate.instanceId === shell.modelSelection.instanceId);
  const timeline = useVersionsTimeline(environmentId, threadId, shell);

  const check = (itemId: string): RewindCheck | null => {
    if (projection === null) return null;
    const item = projection.turnItems.find((candidate) => candidate.id === itemId);
    if (item === undefined || item.type !== "user_message") return { ok: false, block: "gone" };
    return rewindCheck({
      projection,
      item,
      canOperate,
      archived,
      active: shell ? threadRuntimeIsActive(shell.runtime) : false,
      supportsRollback: provider?.supportsConversationRollback !== false,
    });
  };

  const choiceFor = (target: RewindTarget): FilesChoice =>
    filesChoice({
      filesChanged: target.filesChanged,
      worksInPrivateCopy: canRollbackFilesFor(shell),
      versionBlocker:
        timeline.byId.get(target.checkpointId)?.restoreExplainer.blockedBecause ?? null,
    });

  const findItem = (itemId: string): UserMessage | null => {
    const item = projection?.turnItems.find((candidate) => candidate.id === itemId);
    return item?.type === "user_message" ? item : null;
  };

  return { check, choiceFor, findItem };
}

/**
 * Asks the engine to go back and resolves once it has: the edited message's run is marked
 * rolled back (the same moment the provider's conversation was cut), or the engine said why
 * not. Resolves to null on success, else a plain sentence.
 */
export function useGoBackCommand(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection | null;
}) {
  const { environmentId, threadId, projection } = input;
  const revert = useAtomCommand(threadEnvironment.revertCheckpoint, { reportFailure: false });
  const latest = useRef(projection);
  const waiter = useRef<{
    readonly commandId: string;
    readonly witnessRunId: RewindTarget["witnessRunId"];
    readonly resolve: (problem: string | null) => void;
  } | null>(null);

  const settle = () => {
    const current = waiter.current;
    const now = latest.current;
    if (current === null || now === null) return;
    const progress = rewindProgress(now, current);
    if (progress === "waiting") return;
    waiter.current = null;
    current.resolve(progress === "done" ? null : plainRestoreProblem(new Error(progress.failed)));
  };
  useEffect(() => {
    latest.current = projection;
    settle();
  });
  useEffect(
    () => () => {
      waiter.current?.resolve("You left before it finished. Open the conversation to check it.");
      waiter.current = null;
    },
    [],
  );

  return async (target: RewindTarget, restoreFiles: boolean): Promise<string | null> => {
    const commandId = CommandId.make(randomUUID());
    const outcome = await revert({
      environmentId,
      input: {
        commandId,
        threadId,
        checkpointId: target.checkpointId,
        scopeId: target.scopeId,
        restoreFiles,
      },
    });
    if (outcome._tag === "Failure") return plainRestoreProblem(squashAtomCommandFailure(outcome));
    return new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => {
        if (waiter.current?.commandId !== commandId) return;
        waiter.current = null;
        resolve(
          "Going back is taking longer than usual. Wait a moment, then check the conversation before sending again.",
        );
      }, GO_BACK_TIMEOUT_MS);
      waiter.current = {
        commandId,
        witnessRunId: target.witnessRunId,
        resolve: (problem) => {
          window.clearTimeout(timer);
          resolve(problem);
        },
      };
      settle();
    });
  };
}
