// The page a conversation made: the header's Preview opens it, the same page "Play it" opens,
// instead of the project's index.html (which may be an older make in the same project).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { describeChanges, describeTurnDiff, fromCheckpointFiles } from "../../plain/changes";
import { useEnvironmentQuery } from "~/state/query";
import { environmentThreads } from "../../state/threads";
import { orchestrationEnvironment } from "../../state/vcs";
import { previewablePage } from "../starters/preview";
import { reviewTargetFor } from "./turnReview";

/**
 * The page to open from the files the newest turn changed: a new .html file first, then an
 * edited one, `index.html` preferred among equals. Null when that turn made no page, and the
 * Preview then shows the project's own first page.
 */
export function pageOfTurn(
  files: ReadonlyArray<{
    readonly path: string;
    readonly operation: "added" | "edited" | "deleted" | "renamed";
  }>,
): string | null {
  return previewablePage(files);
}

/** The newest page this conversation made, once its newest turn's changes are known. */
export function useMadePage(environmentId: EnvironmentId, threadId: ThreadId): string | null {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const target = projection ? reviewTargetFor(projection, threadId) : null;
  const diff = useEnvironmentQuery(
    target?.diffInput
      ? orchestrationEnvironment.turnDiff({ environmentId, input: target.diffInput })
      : null,
  );
  if (!target) return null;
  const fromDiff = diff.data ? describeTurnDiff(diff.data.diff) : null;
  const what =
    fromDiff && fromDiff.counts.files > 0
      ? fromDiff
      : describeChanges(fromCheckpointFiles(target.checkpoint.files));
  return pageOfTurn(what.groups.flatMap((group) => group.files));
}
