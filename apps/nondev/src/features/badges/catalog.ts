// What each sticker is called, what it says when it arrives, and the plain hint shown while it
// is still to find. The hints say what to do, never "don't miss out": a sticker is a nice
// surprise, not a chore. `sticker` names the art in stickers/Sticker.tsx (same id).
import type { BadgeId } from "@t3tools/skycot-rules/badges";

export interface BadgeCopy {
  readonly title: string;
  /** Said when it arrives, after "You found a sticker!". */
  readonly cheer: string;
  /** How to find it, in a child's words. */
  readonly hint: string;
  /** Only makes sense in a Family profile (siblings, bedtime). */
  readonly familyOnly?: true;
}

export const BADGE_COPY: Readonly<Record<BadgeId, BadgeCopy>> = {
  "first-creation": {
    title: "First creation",
    cheer: "You made your very first thing with SKYCOT!",
    hint: "Make anything at all with SKYCOT.",
  },
  "first-game": {
    title: "Game maker",
    cheer: "You made a game. Sam wants a turn!",
    hint: "Make a game you can play.",
  },
  "animal-friend": {
    title: "Animal friend",
    cheer: "A page about an animal. So cute!",
    hint: "Make a page about a pet or an animal.",
  },
  "drew-it": {
    title: "Drew it first",
    cheer: "You showed SKYCOT your drawing.",
    hint: "Add a picture of your drawing to a message.",
  },
  "big-question": {
    title: "Big questions",
    cheer: "Three times you asked “How did you do that?”",
    hint: "Ask “How did you do that?” three times.",
  },
  undo: {
    title: "Back in time",
    cheer: "You used Undo to go back. Clever!",
    hint: "Use Undo to go back after a change.",
  },
  "mo-check": {
    title: "Mo's helper",
    cheer: "Mo checked something, and you made it better.",
    hint: "Make a change after Mo double-checks something.",
  },
  voice: {
    title: "Said it out loud",
    cheer: "SKYCOT heard you through the microphone.",
    hint: "Say what you want with voice typing, once a grown-up turns it on.",
  },
  together: {
    title: "Built together",
    cheer: "Two of you built on the same project.",
    hint: "Build on the same project as someone else in your family.",
    familyOnly: true,
  },
  "kind-words": {
    title: "Kind words",
    cheer: "You said please or thank you. SKYCOT is blushing.",
    hint: "Say please or thank you to SKYCOT.",
  },
  "good-night": {
    title: "Good night",
    cheer: "You let SKYCOT sleep at bedtime. Sweet dreams!",
    hint: "When it's bedtime, let SKYCOT sleep.",
    familyOnly: true,
  },
  five: {
    title: "Five things",
    cheer: "Five different things made!",
    hint: "Make five different things.",
  },
  ten: {
    title: "Ten things",
    cheer: "Ten different things made. Wow!",
    hint: "Make ten different things.",
  },
  explorer: {
    title: "Explorer",
    cheer: "You tried three different starter cards.",
    hint: "Try three different starter cards.",
  },
  storyteller: {
    title: "Storyteller",
    cheer: "You made a story. What happens next?",
    hint: "Make a comic or a story.",
  },
  designer: {
    title: "Designer",
    cheer: "You changed how your page looks.",
    hint: "Ask SKYCOT to change the colours or look of your page.",
  },
};

/** "22 Oct" in the reader's own words for dates. */
export function earnedDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(at);
}

/** The first name only, for anything that could be printed or shown to others. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
}
