// nondev-seam: skycot-iphone-q39-recent-conversations-test
import { describe, expect, it } from "vite-plus/test";

import type { ConversationRow } from "../../data/conversations";
import { recentRows } from "./recentConversations";

describe("recent conversations on Make", () => {
  it("keeps only the latest three rows", () => {
    const rows = Array.from(
      { length: 5 },
      (_, index) => ({ key: String(index) }) as ConversationRow,
    );
    expect(recentRows(rows).map((row) => row.key)).toEqual(["0", "1", "2"]);
    expect(recentRows(rows.slice(0, 2))).toHaveLength(2);
  });
});
