import { describe, expect, it } from "vite-plus/test";

import type { FridgeItem } from "../../../nondev/src/features/fridge/fridge";
import { shownNoteTarget } from "./noteTarget";

const magnet = (threadId: string, page: string): FridgeItem => ({
  threadId,
  projectId: "p1",
  title: "Create an Offline Bubbles Pet Page",
  childId: "ava",
  madeAt: 1,
  page,
  cwd: "/tmp/p1",
  pinnedAt: null,
});

const shown = { kind: "shown", threadId: "t1", title: "Bubbles pet" } as const;

describe("Open it on a family note", () => {
  it("opens the page the conversation made, on the Mac it came from", () => {
    expect(
      shownNoteTarget("mac-1", shown, [magnet("t2", "x.html"), magnet("t1", "pet.html")]),
    ).toEqual({
      name: "Page",
      params: { macId: "mac-1", threadId: "t1", page: "pet.html", title: "Bubbles pet page" },
    });
  });

  it("falls back to the conversation, read only, when there is no page to show", () => {
    for (const fridge of [null, [], [magnet("t2", "x.html")]]) {
      expect(shownNoteTarget("mac-1", shown, fridge)).toEqual({
        name: "Conversation",
        params: { macId: "mac-1", threadId: "t1", title: "Bubbles pet", readOnly: true },
      });
    }
  });

  it("has nothing to open for more-time notes or a note without a conversation", () => {
    expect(shownNoteTarget("mac-1", { kind: "more-time" }, [])).toBeNull();
    expect(shownNoteTarget("mac-1", { kind: "shown", title: "x" }, [])).toBeNull();
    expect(shownNoteTarget("mac-1", { kind: "shown", threadId: "", title: "x" }, [])).toBeNull();
  });
});
