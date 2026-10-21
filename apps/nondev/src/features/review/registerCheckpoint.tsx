// Claims the `checkpoint` turn item for the conversation stream: the point that
// closes a turn with file changes becomes the "What changed" card. Checkpoints
// from tool and sub-agent scopes, and empty ones, stay hidden.
import { registerTimelineRenderer } from "../conversation/Timeline";
import { Bubble } from "../../ui/Bubble";
import { ReviewSection } from "./ReviewSection";
import { rootScopeIds } from "./turnReview";

registerTimelineRenderer("checkpoint", ({ item, projection, environmentId, threadId }) => {
  if (item.type !== "checkpoint" || item.files.length === 0) return null;
  if (!rootScopeIds(projection).has(item.scopeId)) return null;
  return (
    <Bubble author="crew" full>
      <ReviewSection
        environmentId={environmentId}
        threadId={threadId}
        checkpointId={item.checkpointId}
      />
    </Bubble>
  );
});
