// Claims the `checkpoint` turn item for the conversation stream: the point that
// closes a turn with file changes becomes the "What changed" card. Checkpoints
// from tool and sub-agent scopes, and empty ones, stay hidden.
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";

import { registerTimelineRenderer } from "../conversation/Timeline";
import { ExplainAsk } from "../explain/ExplainAsk";
import { Bubble } from "../../ui/Bubble";
import { ReviewSection } from "./ReviewSection";
import { rootScopeIds } from "./turnReview";

registerTimelineRenderer("checkpoint", ({ item, projection, environmentId, threadId, shell }) => {
  if (item.type !== "checkpoint" || item.files.length === 0) return null;
  if (!rootScopeIds(projection).has(item.scopeId)) return null;
  const run = projection.runs.find((candidate) => candidate.id === item.runId);
  return (
    <Bubble author="crew" full>
      <ReviewSection
        environmentId={environmentId}
        threadId={threadId}
        checkpointId={item.checkpointId}
      />
      {run?.status === "rolled_back" ? null : (
        <ExplainAsk
          runId={item.runId}
          projection={projection}
          environmentId={environmentId}
          threadId={threadId}
          shell={shell}
          active={shell ? threadRuntimeIsActive(shell.runtime) : false}
        />
      )}
    </Bubble>
  );
});
