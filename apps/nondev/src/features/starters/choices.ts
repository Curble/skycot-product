// Picture choices for the step picker (StepPickerSheet.tsx): for every `[blank]` of every kid
// starter card, a short question and eight big tiles, so a child who cannot yet type over a
// bracketed phrase can still build their sentence by tapping. Pure data and string building,
// tested in choices.test.ts. Labels are written the way they read inside the sentence (lower
// case unless a name), so `fillBlanks` can drop them straight in; the sheet capitalises them
// for display only. The questions never mention ages or reading levels.

import { KID_STARTERS } from "./starters";

export interface BlankChoice {
  readonly label: string;
  /** One common emoji. */
  readonly art: string;
}

export interface BlankChoices {
  readonly starterId: string;
  /** 0-based, in the order the `[blanks]` appear in the card's `ask`. */
  readonly blankIndex: number;
  readonly question: string;
  readonly choices: ReadonlyArray<BlankChoice>;
}

function blank(
  starterId: string,
  blankIndex: number,
  question: string,
  pairs: ReadonlyArray<readonly [art: string, label: string]>,
): BlankChoices {
  return {
    starterId,
    blankIndex,
    question,
    choices: pairs.map(([art, label]) => ({ art, label })),
  };
}

const NUMBERS: ReadonlyArray<readonly [string, string]> = [
  ["5️⃣", "5"],
  ["6️⃣", "6"],
  ["7️⃣", "7"],
  ["8️⃣", "8"],
  ["9️⃣", "9"],
  ["🔟", "10"],
  ["🎈", "11"],
  ["🎉", "12"],
];

export const BLANK_CHOICES: ReadonlyArray<BlankChoices> = [
  blank("game", 0, "What kind of game?", [
    ["⭐", "catch the falling stars"],
    ["🧩", "a maze"],
    ["🐍", "snake"],
    ["🏎️", "a racing game"],
    ["🫧", "pop the bubbles"],
    ["🃏", "a memory game"],
    ["🦘", "jump over things"],
    ["👾", "feed the monster"],
  ]),
  blank("pet", 0, "What animal is it?", [
    ["🐶", "dog"],
    ["🐱", "cat"],
    ["🐰", "rabbit"],
    ["🐹", "hamster"],
    ["🐠", "fish"],
    ["🐦", "bird"],
    ["🐴", "horse"],
    ["🐢", "turtle"],
  ]),
  blank("pet", 1, "What's its name?", [
    ["🍪", "Biscuit"],
    ["🌸", "Bella"],
    ["⚡", "Max"],
    ["🌙", "Luna"],
    ["🦴", "Buddy"],
    ["🥥", "Coco"],
    ["🎾", "Milo"],
    ["🌼", "Daisy"],
  ]),
  blank("birthday", 0, "Who is it for?", [
    ["👵", "my Nan"],
    ["🧑‍🤝‍🧑", "my best friend"],
    ["👩", "Mum"],
    ["👨", "Dad"],
    ["🍎", "my teacher"],
    ["👦", "my brother"],
    ["👧", "my sister"],
    ["🤗", "my cousin"],
  ]),
  blank("birthday", 1, "How many candles?", NUMBERS),
  blank("school", 0, "What is it about?", [
    ["🌋", "volcanoes"],
    ["🪐", "the planets"],
    ["🦖", "dinosaurs"],
    ["🌊", "the ocean"],
    ["🐝", "bees"],
    ["🏰", "castles"],
    ["🌴", "the rainforest"],
    ["🤖", "robots"],
  ]),
  blank("comic", 0, "What happens?", [
    ["🐱", "a cat who wants to fly"],
    ["🐶", "a dog who loves pizza"],
    ["🐭", "a mouse on the moon"],
    ["🏴‍☠️", "a pirate and a parrot"],
    ["👻", "a shy little ghost"],
    ["🐉", "a dragon who is lost"],
    ["🐧", "a penguin on a bike"],
    ["🤖", "a dancing robot"],
  ]),
  blank("quiz", 0, "How many questions?", [
    ["3️⃣", "3"],
    ["4️⃣", "4"],
    ["5️⃣", "5"],
    ["6️⃣", "6"],
    ["7️⃣", "7"],
    ["8️⃣", "8"],
    ["9️⃣", "9"],
    ["🔟", "10"],
  ]),
  blank("quiz", 1, "What is it about?", [
    ["🐾", "animals"],
    ["🚀", "space"],
    ["🦖", "dinosaurs"],
    ["⚽", "football"],
    ["🍕", "food"],
    ["🎨", "colours"],
    ["🦸", "superheroes"],
    ["🐙", "the sea"],
  ]),
  blank("draw", 0, "Anything extra?", [
    ["🙂", "nothing extra"],
    ["🌀", "make it spin"],
    ["🦘", "make it bounce"],
    ["〰️", "make it wiggle"],
    ["✨", "add sparkles"],
    ["🎵", "make it play a sound"],
    ["🌈", "make it change colour"],
    ["🔤", "add a big title"],
  ]),
];

/** The questions and tiles for one card, one entry per `[blank]`, in order. */
export function choicesFor(starterId: string): ReadonlyArray<BlankChoices> {
  return BLANK_CHOICES.filter((entry) => entry.starterId === starterId).toSorted(
    (a, b) => a.blankIndex - b.blankIndex,
  );
}

const BLANK_PATTERN = /\[[^\]\n]+\]/g;

/** How many `[blanks]` a prompt has. */
export function blankCount(ask: string): number {
  return ask.match(BLANK_PATTERN)?.length ?? 0;
}

/** Whether a card should open the step picker: a kid card with blanks that all have tiles. */
export function hasPicker(starterId: string): boolean {
  const starter = KID_STARTERS.find((entry) => entry.id === starterId);
  if (starter === undefined) return false;
  const count = blankCount(starter.ask);
  return count > 0 && choicesFor(starterId).length === count;
}

/** Replaces the blanks in order; a missing (or empty) answer leaves its blank as it is. */
export function fillBlanks(ask: string, answers: ReadonlyArray<string | null | undefined>): string {
  let index = 0;
  return ask.replace(BLANK_PATTERN, (whole) => {
    const answer = answers[index];
    index += 1;
    return answer === undefined || answer === null || answer.trim() === "" ? whole : answer.trim();
  });
}

/** Surprise me for one step: any of the tiles, with an injectable `random` in [0, 1). */
export function pickRandom<T>(choices: ReadonlyArray<T>, random: () => number): T {
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)));
  return choices[index]!;
}

/** A tile's label as shown: first letter in capitals ("my Nan" shows as "My Nan"). */
export function shownLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
