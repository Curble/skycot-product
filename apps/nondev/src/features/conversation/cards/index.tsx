// Registers every rich card with the timeline. Importing this module once (the
// Timeline does it) is enough; tool-ish items never reach the registry because
// the stream folds them into WorkingCard first (see grouping.ts).
import { parseExplanation, readExplainMarker } from "@t3tools/skycot-rules/explain";
import { readPointing } from "@t3tools/skycot-rules/preview";

import { ExplainCard } from "../../explain/ExplainCard";
import { CrewBubble, ErrorNote, UserBubble } from "./MessageBubbles";
import { PlanCard } from "./PlanCard";
import { registerTimelineRenderer } from "./registry";
import { RequestCard } from "./RequestCard";

// The explain-mode marker is for the engine; the person sees what they typed.
// So is the "Point at something" block: the person sees chips, the assistant the element.
registerTimelineRenderer("user_message", ({ item, environmentId }) => {
  if (item.type !== "user_message") return null;
  const pointing = readPointing(readExplainMarker(item.text).text);
  return (
    <UserBubble
      item={{ ...item, text: pointing.text }}
      environmentId={environmentId}
      pointing={pointing.labels}
    />
  );
});
// A "How I did it" section becomes its own Explain card under the message.
registerTimelineRenderer("assistant_message", (context) => {
  const { item } = context;
  if (item.type !== "assistant_message") return null;
  const explanation = parseExplanation(item.text);
  if (explanation === null) return <CrewBubble item={item} />;
  return (
    <>
      {explanation.body.length > 0 ? (
        <CrewBubble item={{ ...item, text: explanation.body }} />
      ) : null}
      <ExplainCard
        explanation={explanation}
        runId={item.runId}
        streaming={item.streaming}
        projection={context.projection}
        environmentId={context.environmentId}
        threadId={context.threadId}
      />
    </>
  );
});
registerTimelineRenderer("proposed_plan", (context) =>
  context.item.type === "proposed_plan" ? <PlanCard item={context.item} context={context} /> : null,
);
registerTimelineRenderer("approval_request", (context) =>
  context.item.type === "approval_request" ? (
    <RequestCard item={context.item} context={context} />
  ) : null,
);
registerTimelineRenderer("user_input_request", (context) =>
  context.item.type === "user_input_request" ? (
    <RequestCard item={context.item} context={context} />
  ) : null,
);
registerTimelineRenderer("secret_request", (context) =>
  context.item.type === "secret_request" ? (
    <RequestCard item={context.item} context={context} />
  ) : null,
);
registerTimelineRenderer("error", (context) =>
  context.item.type === "error" ? <ErrorNote item={context.item} context={context} /> : null,
);

export { groupTimelineItems, WORK_ITEM_TYPES } from "./grouping";
export type { TimelineEntry, WorkGroup } from "./grouping";
