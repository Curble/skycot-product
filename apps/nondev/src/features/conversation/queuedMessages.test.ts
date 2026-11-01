import { describe, expect, it } from "vite-plus/test";

import { canOfferEdit, canOfferTakeBack } from "../rewind/rewind";
import { turnItem } from "../../plain/fixtures.test-helpers";
import {
  isWaitingQueuedRow,
  withQueuedMessageItems,
  type QueuedMessageSource,
} from "./queuedMessages";

const NOW = "2026-11-02T00:00:00.000Z";
const run = (id: string, ordinal: number, status: string, userMessageId: string) => ({
  id,
  ordinal,
  status,
  userMessageId,
  rootNodeId: `node-${id}`,
  providerThreadId: "provider-thread-1",
  queuePosition: status === "queued" ? ordinal : null,
});
const message = (id: string, text: string) => ({
  id,
  threadId: "thread-1",
  role: "user",
  text,
  attachments: [],
  createdBy: "user",
  creationSource: "web",
  createdAt: NOW,
  updatedAt: NOW,
});

function source(): QueuedMessageSource {
  const first = turnItem(
    "user_message",
    {
      messageId: "m1",
      inputIntent: "turn_start",
      text: "first",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    },
    { runId: "run-1" },
  );
  return {
    turnItems: [first],
    runs: [run("run-1", 1, "running", "m1"), run("run-2", 2, "queued", "m2")],
    // The engine has the second message and its queued run, but no row for it yet.
    messages: [message("m1", "first"), message("m2", "second")],
  } as unknown as QueuedMessageSource;
}

describe("withQueuedMessageItems", () => {
  it("shows a lined-up message at once, as one that can be taken back", () => {
    const projection = source();
    const items = withQueuedMessageItems(projection);
    expect(items).toHaveLength(2);
    const added = items[1];
    expect(added?.type === "user_message" && added.text).toBe("second");
    expect(added?.type === "user_message" && added.inputIntent).toBe("queued_turn");
    expect(added !== undefined && canOfferTakeBack(added, projection.runs)).toBe(true);
    expect(added !== undefined && canOfferEdit(added, projection.runs)).toBe(false);
    expect(added?.ordinal).toBeGreaterThan(items[0]?.ordinal ?? 0);
    // Only the waiting row reads "Lined up for later"; the engine's own row, once started, does not.
    expect(added !== undefined && isWaitingQueuedRow(added)).toBe(true);
    expect(items[0] !== undefined && isWaitingQueuedRow(items[0])).toBe(false);
  });

  it("adds nothing once the engine has written the row, or for a run that is not queued", () => {
    const projection = source();
    const withRow = {
      ...projection,
      turnItems: [
        ...projection.turnItems,
        turnItem(
          "user_message",
          {
            messageId: "m2",
            inputIntent: "queued_turn",
            text: "second",
            attachments: [],
            createdBy: "user",
            creationSource: "web",
          },
          { runId: "run-2" },
        ),
      ],
    } as unknown as QueuedMessageSource;
    expect(withQueuedMessageItems(withRow)).toBe(withRow.turnItems);
    const started = {
      ...projection,
      runs: [run("run-1", 1, "running", "m1"), run("run-2", 2, "starting", "m2")],
    } as unknown as QueuedMessageSource;
    expect(withQueuedMessageItems(started)).toBe(started.turnItems);
    const cancelled = {
      ...projection,
      runs: [run("run-1", 1, "running", "m1"), run("run-2", 2, "cancelled", "m2")],
    } as unknown as QueuedMessageSource;
    expect(withQueuedMessageItems(cancelled)).toBe(cancelled.turnItems);
  });

  it("keeps several lined-up messages in the order they wait", () => {
    const projection = source();
    const many = {
      ...projection,
      runs: [...projection.runs, run("run-3", 3, "queued", "m3")],
      messages: [...projection.messages, message("m3", "third")],
    } as unknown as QueuedMessageSource;
    const texts = withQueuedMessageItems(many).flatMap((i) =>
      i.type === "user_message" ? [i.text] : [],
    );
    expect(texts).toEqual(["first", "second", "third"]);
  });
});
