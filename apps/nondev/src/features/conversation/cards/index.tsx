// Registers every rich card with the timeline. Importing this module once (the
// Timeline does it) is enough; tool-ish items never reach the registry because
// the stream folds them into WorkingCard first (see grouping.ts).
import { CrewBubble, ErrorNote, UserBubble } from "./MessageBubbles";
import { registerTimelineRenderer } from "./registry";

registerTimelineRenderer("user_message", ({ item }) =>
  item.type === "user_message" ? <UserBubble item={item} /> : null,
);
registerTimelineRenderer("assistant_message", ({ item }) =>
  item.type === "assistant_message" ? <CrewBubble item={item} /> : null,
);
registerTimelineRenderer("error", (context) =>
  context.item.type === "error" ? <ErrorNote item={context.item} context={context} /> : null,
);

export { groupTimelineItems, WORK_ITEM_TYPES } from "./grouping";
export type { TimelineEntry, WorkGroup } from "./grouping";
