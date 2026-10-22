import { describe, expect, it } from "vite-plus/test";

import { withExplainMarker } from "@t3tools/skycot-rules/explain";

import { items, NOW_ISO, turnItem } from "../../plain/fixtures.test-helpers";
import { ASK_FOR_EXPLANATION } from "../explain/ExplainAsk";
import { GROWN_UP_STARTERS, KID_STARTERS, starterPrompt } from "../starters/starters";
import { conversationEvents, creationTopics, FRESH_MESSAGE_MS, messageFacts } from "./facts";

const NOW = Date.parse(NOW_ISO);
const kid = (id: string) => KID_STARTERS.find((starter) => starter.id === id)!;

const user = (messageId: string, text: string, extra: Record<string, unknown> = {}) =>
  turnItem("user_message", {
    messageId,
    inputIntent: "turn_start",
    text,
    attachments: [],
    createdBy: "user",
    creationSource: "web",
    ...extra,
  });

describe("message facts", () => {
  it("knows every starter card from the words it wrote, blanks filled in or not", () => {
    for (const starter of [...KID_STARTERS, ...GROWN_UP_STARTERS]) {
      const text = starterPrompt(starter, () => 0).replace(/\[[^\]]+\]/g, "a dragon");
      expect(messageFacts(text, 0).starter).toBe(starter.id);
    }
    expect(messageFacts("make me a game please", 0).starter).toBeNull();
  });

  it("a card's own 'Please' is not the child's kind words; the child's is", () => {
    expect(messageFacts(starterPrompt(kid("game")), 0).kindWords).toBe(false);
    expect(messageFacts("can you make the cat jump please", 0).kindWords).toBe(true);
    expect(messageFacts("Thank you SKYCOT!", 0).kindWords).toBe(true);
    expect(messageFacts("make it pink", 0).kindWords).toBe(false);
  });

  it("hears 'How did you do that?' from the button and from the child", () => {
    expect(messageFacts(withExplainMarker(ASK_FOR_EXPLANATION, true, false), 0).askedHow).toBe(
      true,
    );
    expect(messageFacts("wow how did you make that??", 0).askedHow).toBe(true);
    expect(messageFacts("how do I play", 0).askedHow).toBe(false);
  });

  it("a look change is about colours, fonts or the look", () => {
    expect(messageFacts("can the background be purple", 0).lookChange).toBe(true);
    expect(messageFacts("make the title font bigger", 0).lookChange).toBe(true);
    expect(messageFacts("add another level", 0).lookChange).toBe(false);
  });

  it("a picture is a picture", () => {
    expect(messageFacts("here is my drawing", 1).picture).toBe(true);
    expect(messageFacts("here is my drawing", 0).picture).toBe(false);
  });

  it("reads what a creation is about from the child's words, not a card's template", () => {
    expect(creationTopics("a page about my puppy Biscuit", null)).toEqual({
      game: false,
      animal: true,
      story: false,
    });
    expect(creationTopics("a maze game with a dragon story", null)).toEqual({
      game: true,
      animal: true,
      story: true,
    });
    // The quiz card says "keep score"; the card decides, and a quiz is not a game sticker.
    expect(creationTopics(starterPrompt(kid("quiz")), "quiz")).toEqual({
      game: false,
      animal: false,
      story: false,
    });
  });
});

describe("conversation events", () => {
  it("a finished creation is reported with its card and first-message topics", () => {
    const events = conversationEvents({
      projection: { turnItems: [user("m1", starterPrompt(kid("pet")))] },
      threadId: "t1",
      title: "My pet Biscuit",
      madeSomething: true,
      now: NOW,
    });
    expect(events.at(-1)).toEqual({
      type: "made",
      threadId: "t1",
      title: "My pet Biscuit",
      starter: "pet",
      topics: { game: false, animal: false, story: false },
    });
  });

  it("nothing is made until SKYCOT changed files", () => {
    const events = conversationEvents({
      projection: { turnItems: [user("m1", "make a game")] },
      threadId: "t1",
      title: null,
      madeSomething: false,
      now: NOW,
    });
    expect(events.map((event) => event.type)).toEqual(["message"]);
  });

  it("only messages sent moments ago are this device's; old ones are history", () => {
    const events = conversationEvents({
      projection: { turnItems: [user("m1", "make a game please")] },
      threadId: "t1",
      title: null,
      madeSomething: false,
      now: NOW + FRESH_MESSAGE_MS + 1,
    });
    expect(events).toEqual([]);
  });

  it("a follow-up after Mo double-checked is a change after Mo's check", () => {
    const events = conversationEvents({
      projection: {
        turnItems: [
          user("m1", "make a game"),
          items.assistant(
            "Done!\n\n**How I did it:** I drew a box.\n**Double-check:** I clicked Play and it worked.",
          ),
          user("m2", "make the background blue"),
        ],
      },
      threadId: "t1",
      title: null,
      madeSomething: false,
      now: NOW,
    });
    expect(events).toMatchObject([
      { type: "message", messageId: "m1", followUp: false, afterCheck: false },
      { type: "message", messageId: "m2", followUp: true, afterCheck: true, lookChange: true },
    ]);
  });

  it("an automation's conversation is never a creation", () => {
    const events = conversationEvents({
      projection: {
        turnItems: [
          user("m1", "check the site", { scheduledTaskId: "task-1", createdBy: "system" }),
        ],
      },
      threadId: "t1",
      title: null,
      madeSomething: true,
      now: NOW,
    });
    expect(events).toEqual([]);
  });
});
