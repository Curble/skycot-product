// The newest retry after a turn that failed part-way, when its span's diff shows it made
// something: the stream scrolls to its card and the sticker book counts it, like any turn
// whose own summary lists files. Asks the engine for one diff, and only in that case.
import type { EnvironmentId, OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "~/state/query";

import { parseUnifiedDiff } from "../../plain/changes";
import { orchestrationEnvironment } from "../../state/vcs";
import { latestRetryCheckpoint, reviewTargetFor } from "./turnReview";

export function useRetryMade(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projection: OrchestrationV2ThreadProjection | null,
): string | null {
  const checkpoint = projection ? latestRetryCheckpoint(projection) : undefined;
  const diffInput =
    projection && checkpoint
      ? (reviewTargetFor(projection, threadId, checkpoint.id)?.diffInput ?? null)
      : null;
  const diff = useEnvironmentQuery(
    diffInput === null
      ? null
      : orchestrationEnvironment.turnDiff({ environmentId, input: diffInput }),
  );
  if (!checkpoint || !diff.data) return null;
  return parseUnifiedDiff(diff.data.diff).length > 0 ? checkpoint.id : null;
}
