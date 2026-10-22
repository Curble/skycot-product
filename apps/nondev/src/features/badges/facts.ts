// A message turned into the few facts the sticker rules need, here in the browser, so a
// child's words never travel to the sticker file. Pure: tested in facts.test.ts.
//
// The words that count are the child's own. A starter card's prompt says "Please make…", so a
// message from a card never counts as kind words, and what a card is about comes from the card
// itself, not from words in its template ("keep score" in the quiz card is not a game).
import type { BadgeEvent, CreationTopics } from "@t3tools/skycot-rules/badges";
import { parseExplanation, readExplainMarker } from "@t3tools/skycot-rules/explain";
import { readPointing } from "@t3tools/skycot-rules/preview";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { GROWN_UP_RULES, GROWN_UP_STARTERS, KID_STARTERS } from "../starters/starters";

/** The starter card a message came from, read from the words the card wrote. */
export function starterIdFromText(text: string): string | null {
  for (const starter of KID_STARTERS) {
    if (starter.fileName && text.includes(`Make it one new file called ${starter.fileName},`)) {
      return starter.id;
    }
  }
  if (!text.includes(GROWN_UP_RULES)) return null;
  const trimmed = text.trimStart();
  for (const starter of GROWN_UP_STARTERS) {
    const opening = starter.ask.split("[")[0]!.trim();
    if (opening.length > 0 && trimmed.startsWith(opening)) return starter.id;
  }
  return null;
}

const KIND = /\b(please|pls|plz|thank\s?you|thanks|thankyou|thx|cheers)\b/i;
/** Also matches the "How did you do that?" button's own message (features/explain). */
const ASKED_HOW = /\bhow (did|do) you (do|make|build|code|program) (that|this|it)\b/i;
const LOOK =
  /\b(colou?rs?|colou?rful|background|fonts?|bigger|smaller|looks?|style|theme|pink|purple|rainbow|glitter|sparkl\w*|shiny|darker|lighter|brighter|red|blue|green|yellow|orange|gold|neon|pastel)\b/i;
const GAME =
  /\b(games?|maze|platformer|pong|snake game|tic[- ]?tac[- ]?toe|racing|race car|obstacle|dodge|jumping game|high score)\b/i;
const ANIMAL =
  /\b(pets?|dogs?|pupp(?:y|ies)|cats?|kittens?|kitty|bunn(?:y|ies)|rabbits?|horses?|pon(?:y|ies)|fish|goldfish|hamsters?|guinea pigs?|birds?|parrots?|budgies?|turtles?|tortoises?|lizards?|frogs?|animals?|dinosaurs?|dinos?|lions?|tigers?|elephants?|monkeys?|penguins?|sharks?|dolphins?|whales?|axolotls?|owls?|ducks?|chickens?|cows?|pigs?|sheep|goats?|fox(?:es)?|bears?|pandas?|koalas?|kangaroos?|wombats?|unicorns?|dragons?)\b/i;
const STORY = /\b(story|stories|comics?|tales?|fairy ?tales?|once upon|adventure|storybook)\b/i;

/** What a creation is about, from its first message (the card, or the child's words). */
export function creationTopics(text: string, starter: string | null): CreationTopics {
  if (starter !== null) return { game: false, animal: false, story: false };
  // The child's own words: the pointing block is the page's HTML, not something they said.
  const words = readPointing(readExplainMarker(text).text).text;
  return { game: GAME.test(words), animal: ANIMAL.test(words), story: STORY.test(words) };
}

export interface MessageFacts {
  readonly starter: string | null;
  readonly picture: boolean;
  readonly kindWords: boolean;
  readonly askedHow: boolean;
  readonly lookChange: boolean;
}

export function messageFacts(text: string, pictures: number): MessageFacts {
  const words = readPointing(readExplainMarker(text).text).text;
  const starter = starterIdFromText(words);
  return {
    starter,
    picture: pictures > 0,
    kindWords: starter === null && KIND.test(words),
    askedHow: ASKED_HOW.test(words),
    lookChange: starter === null && LOOK.test(words),
  };
}

type TurnItem = OrchestrationV2ThreadProjection["turnItems"][number];
type UserMessage = Extract<TurnItem, { type: "user_message" }>;

/** A person's message (not an automation's, another conversation's, or the engine's). */
function isPersonMessage(item: TurnItem): item is UserMessage {
  return (
    item.type === "user_message" &&
    item.createdBy === "user" &&
    item.scheduledTaskId === undefined &&
    item.senderThreadId === undefined
  );
}

/** Only a message sent moments ago is this device's child's: an old one is history. */
export const FRESH_MESSAGE_MS = 5 * 60_000;

/**
 * The sticker events one conversation shows right now: each message sent in the last few
 * minutes, and "made" once SKYCOT finished a turn that changed files. The engine counts each
 * message and each conversation once, so sending the same list again is harmless.
 */
export function conversationEvents(input: {
  readonly projection: Pick<OrchestrationV2ThreadProjection, "turnItems">;
  readonly threadId: string;
  readonly title: string | null;
  /** SKYCOT finished a turn that changed files (features/review latestReviewable). */
  readonly madeSomething: boolean;
  readonly now: number;
}): ReadonlyArray<BadgeEvent> {
  const items = [...input.projection.turnItems].sort((a, b) => a.ordinal - b.ordinal);
  const first = items.find(isPersonMessage);
  // Automations start their own conversations; those are not a child's creations.
  const automated = items.some(
    (item) => item.type === "user_message" && item.scheduledTaskId !== undefined,
  );
  const events: BadgeEvent[] = [];
  let checkedBefore = false;
  for (const item of items) {
    if (item.type === "assistant_message" && !item.streaming) {
      if (parseExplanation(item.text)?.check) checkedBefore = true;
      continue;
    }
    if (!isPersonMessage(item)) continue;
    const at = DateTime.toEpochMillis(item.updatedAt);
    if (Math.abs(input.now - at) > FRESH_MESSAGE_MS) {
      continue;
    }
    const facts = messageFacts(item.text, item.attachments.length);
    events.push({
      type: "message",
      messageId: item.messageId,
      threadId: input.threadId,
      followUp: item !== first,
      afterCheck: checkedBefore,
      ...facts,
    });
  }
  if (input.madeSomething && first !== undefined && !automated) {
    const starter = starterIdFromText(readExplainMarker(first.text).text);
    events.push({
      type: "made",
      threadId: input.threadId,
      title: input.title,
      starter,
      topics: creationTopics(first.text, starter),
    });
  }
  return events;
}
