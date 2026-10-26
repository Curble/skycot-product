// nondev-seam: skycot-iphone-q39-recent-conversations
import type { ConversationRow } from "../../data/conversations";

export function recentRows(rows: ReadonlyArray<ConversationRow>): ReadonlyArray<ConversationRow> {
  return rows.slice(0, 3);
}
