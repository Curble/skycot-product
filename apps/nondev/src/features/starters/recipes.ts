// Recipes for the Builder level of build help (BuilderSheet.tsx): for every kids' card with
// blanks, a short checklist of parts a child can tick ("Score", "Levels", "Timer"...), plus a
// label and starting words for each of the card's blanks. The parts become one extra sentence
// ("Also add: ..."), after the card's own sentence, and the whole thing opens as a text box the
// child can change before Send. Pure data and string building, tested in recipes.test.ts.
// Nothing here mentions ages or reading levels.

import { blankCount, choicesFor } from "./choices";
import { KID_STARTERS } from "./starters";

export interface RecipeStepper {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly start: number;
  /** Shown beside the buttons, like "s" for seconds. */
  readonly unit: string;
}

export interface RecipeItem {
  readonly id: string;
  /** One common emoji. */
  readonly art: string;
  readonly title: string;
  /** One short line under the title. */
  readonly hint: string;
  /** What goes in the sentence; `{n}` is the stepper's number. */
  readonly phrase: string;
  readonly stepper?: RecipeStepper;
}

export interface RecipeBlank {
  /** The small label above the text box, like "My game". */
  readonly label: string;
  /** The grey example in the empty box; defaults to the card's first picture choice. It is only
   *  ever shown, never written into the sentence. */
  readonly example?: string;
}

export interface Recipe {
  readonly starterId: string;
  /** One entry per `[blank]` of the card, in order. */
  readonly blanks: ReadonlyArray<RecipeBlank>;
  readonly items: ReadonlyArray<RecipeItem>;
}

const item = (
  id: string,
  art: string,
  title: string,
  hint: string,
  phrase: string,
  stepper?: RecipeStepper,
): RecipeItem => ({
  id,
  // U+FE0F asks for the full-colour picture, never a plain text glyph that takes the text colour.
  art: art.includes("\uFE0F") ? art : `${art}\uFE0F`,
  title,
  hint,
  phrase,
  ...(stepper === undefined ? {} : { stepper }),
});

export const RECIPES: ReadonlyArray<Recipe> = [
  {
    starterId: "game",
    blanks: [{ label: "My game" }],
    items: [
      item("score", "🏆", "Score", "Count the points", "a big score that pops when it goes up"),
      item("levels", "🪜", "Levels", "Gets harder as you go", "levels that get harder"),
      item("sounds", "🔊", "Sounds", "Pops, dings and boings", "sound effects"),
      item("timer", "⏱️", "Timer", "Race the clock", "a {n}-second timer", {
        min: 15,
        max: 180,
        step: 15,
        start: 60,
        unit: "s",
      }),
      item("lives", "❤️", "Lives", "Three tries", "three lives"),
      item("two", "👭", "Two players", "Take turns or race", "a two-player mode"),
      item("high", "🥇", "High scores", "Beat your best", "a high score it remembers"),
      item("power", "✨", "Power-ups", "Surprise boosts", "power-ups that give surprise boosts"),
      item("pause", "⏸️", "Pause button", "Take a break", "a pause button"),
      item("music", "🎵", "Music", "A tune while you play", "a tune that plays while I play"),
    ],
  },
  {
    starterId: "pet",
    blanks: [{ label: "Animal" }, { label: "Name" }],
    items: [
      item("sounds", "🔊", "Sounds", "Say hello with a noise", "a funny sound when they say hello"),
      item("moves", "🐾", "Moving bits", "Ears, tails and paws", "a tail and ears that move"),
      item(
        "faves",
        "🧸",
        "Favourite things",
        "Food, toys, places",
        "a list of their favourite things",
      ),
      item("quiz", "❓", "Pet quiz", "Can friends guess?", "a little quiz about my pet"),
      item(
        "daynight",
        "🌙",
        "Day and night",
        "A switch for the sky",
        "a button that switches between day and night",
      ),
      item(
        "bubble",
        "💬",
        "Speech bubble",
        "Says something new",
        "a speech bubble that says something new each click",
      ),
      item(
        "colours",
        "🎨",
        "Colours",
        "Pick the background",
        "a button that changes the background colour",
      ),
      item("game", "🎾", "Tiny game", "Play with your pet", "a tiny game starring my pet"),
    ],
  },
  {
    starterId: "birthday",
    blanks: [{ label: "Who it's for" }, { label: "Candles" }],
    items: [
      item(
        "balloons",
        "🎈",
        "Floating balloons",
        "Up, up and away",
        "balloons that float up the page",
      ),
      item("music", "🎵", "Happy tune", "A tune to sing along to", "a happy tune"),
      item(
        "message",
        "💌",
        "Secret message",
        "Appears with a click",
        "a secret message that appears when you click",
      ),
      item("candles", "🎂", "Candles", "Blow them out", "candles you can blow out"),
      item("fireworks", "🎆", "Fireworks", "A big finish", "fireworks at the end"),
      item("gift", "🎁", "Gift box", "Open it up", "a gift box that opens"),
      item("countdown", "⏳", "Countdown", "Days to go", "a countdown to the big day"),
      item("sparkle", "✨", "Sparkles", "Follow the mouse", "sparkles that follow the mouse"),
      item("typing", "⌨️", "Typing message", "Writes itself", "a message that types itself out"),
    ],
  },
  {
    starterId: "school",
    blanks: [{ label: "My topic" }],
    items: [
      item("facts", "💡", "Did you know?", "Cool fact boxes", "a few “Did you know?” fact boxes"),
      item("labels", "🏷️", "Labels", "Name the parts", "labels on the diagram"),
      item(
        "contents",
        "📋",
        "Contents list",
        "Jump to a section",
        "a contents list that jumps to each section",
      ),
      item(
        "words",
        "📖",
        "Word list",
        "Explain tricky words",
        "a small word list that explains tricky words",
      ),
      item("timeline", "🕰️", "Timeline", "What happened when", "a timeline"),
      item(
        "button",
        "🔘",
        "Fun fact button",
        "A new fact each click",
        "a button that shows a new fun fact each click",
      ),
      item("dark", "🌙", "Dark mode", "A light and dark switch", "a switch between light and dark"),
      item("score", "🏅", "Quiz score", "Count the right ones", "a score at the end of the quiz"),
    ],
  },
  {
    starterId: "comic",
    blanks: [{ label: "What happens" }],
    items: [
      item("sound", "💥", "Sound words", "POW! BOOM!", "big sound words like POW and BOOM"),
      item("thought", "💭", "Thought bubbles", "What they are thinking", "thought bubbles"),
      item(
        "story",
        "📜",
        "Story boxes",
        "A line at the top",
        "a story box at the top of each panel",
      ),
      item("title", "🏷️", "A title", "A big name for the comic", "a big title"),
      item("ending", "🤣", "Funny last panel", "A surprise at the end", "a funny last panel"),
      item(
        "colours",
        "🎨",
        "Colourful backgrounds",
        "A new colour each panel",
        "a different colourful background in each panel",
      ),
      item(
        "move",
        "🎬",
        "Moving characters",
        "They wiggle when you point",
        "characters that wiggle when you point at them",
      ),
      item("hero", "🦸", "A surprise hero", "Swoops in", "a surprise hero who swoops in"),
    ],
  },
  {
    starterId: "quiz",
    blanks: [{ label: "Questions" }, { label: "Topic" }],
    items: [
      item("timer", "⏱️", "Timer", "Race the clock", "a {n}-second timer for each question", {
        min: 5,
        max: 60,
        step: 5,
        start: 20,
        unit: "s",
      }),
      item("score", "🏆", "Running score", "Always at the top", "a running score at the top"),
      item("hints", "💡", "Hints", "A little help", "a hint button on each question"),
      item(
        "cheer",
        "🔊",
        "Cheer sounds",
        "Hooray for right answers",
        "cheering sounds for right answers",
      ),
      item(
        "streak",
        "🔥",
        "Streaks",
        "Right answers in a row",
        "a streak counter for right answers in a row",
      ),
      item("progress", "📊", "Progress bar", "How far you are", "a progress bar"),
      item(
        "shuffle",
        "🔀",
        "Mixed-up order",
        "Different every time",
        "the questions in a random order",
      ),
      item("confetti", "🎉", "Confetti", "For a perfect score", "confetti for a perfect score"),
    ],
  },
  {
    starterId: "draw",
    blanks: [{ label: "Anything extra", example: "make it spin" }],
    items: [
      item(
        "move",
        "🌀",
        "Things that move",
        "Move when you click",
        "parts of the picture that move when I click",
      ),
      item("sound", "🔊", "Sounds", "Pops and dings", "friendly sounds when I click"),
      item(
        "colour",
        "🌈",
        "Colour button",
        "Change the colours",
        "a button that changes the colours",
      ),
      item(
        "secret",
        "🕵️",
        "A secret",
        "Hidden until you click",
        "something hidden that appears when I click",
      ),
      item("sparkles", "✨", "Sparkles", "Shiny bits", "sparkles"),
      item("title", "🔤", "A big title", "A name for it", "a big title"),
      item("labels", "🏷️", "Labels", "Name the parts", "little labels on the parts of my drawing"),
      item(
        "daynight",
        "🌙",
        "Day and night",
        "A switch for the sky",
        "a button that switches between day and night",
      ),
    ],
  },
];

/** The recipe for a card, or undefined if the card has none (it has no blanks). */
export function recipeFor(starterId: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.starterId === starterId);
}

/** The grey example shown in an empty text box. It is never part of the sentence. */
export function exampleBlank(starterId: string, blankIndex: number): string {
  const recipe = recipeFor(starterId);
  const set = choicesFor(starterId).find((entry) => entry.blankIndex === blankIndex);
  return recipe?.blanks[blankIndex]?.example ?? set?.choices[0]?.label ?? "";
}

/** The part's words with its stepper number filled in. */
export function itemPhrase(entry: RecipeItem, amount: number | undefined): string {
  return entry.phrase.replace("{n}", String(amount ?? entry.stepper?.start ?? ""));
}

/** "a", "a and b", "a, b, and c". */
function listWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/**
 * The card's own sentence for each card, built from the words the child typed. An empty box
 * leaves its piece out, so the sentence stays whole without any example words or [holes].
 * With every box filled these read exactly like the card's own `ask`.
 */
const CARD_SENTENCES: Readonly<Record<string, (b: ReadonlyArray<string>) => string>> = {
  game: ([what]) =>
    `Please make a simple game I can play in the page${what ? `: ${what}` : ""}. Use the arrow keys or the mouse, keep score, and show a big “Play again” button at the end.`,
  pet: ([animal, name]) =>
    `Please make a page all about my pet${animal ? `, a ${animal}` : ""}${name ? `${animal ? " called" : ", called"} ${name}` : ""}. Draw them big using shapes, add three fun facts, and a button that makes them say hello.`,
  birthday: ([who, age]) =>
    `Please make a birthday card page${who ? ` for ${who}` : ""}${age ? `${who ? ", who is turning" : " for someone who is turning"} ${age}` : ""}. Make it bright and happy with balloons, a big “Happy birthday!”, and a button that makes confetti pop.`,
  school: ([topic]) =>
    `Please make a one-page project${topic ? ` about ${topic}` : ""}. Give it a title, three short sections with headings, a simple diagram drawn with shapes, and a five-question quiz at the end.`,
  comic: ([what]) =>
    `Please make a four-panel comic strip${what ? ` about ${what}` : ""}. Draw the characters with simple shapes and put the words in speech bubbles.`,
  quiz: ([count, topic]) =>
    `Please make a quiz${count ? ` with ${count} questions` : ""}${topic ? ` about ${topic}` : ""}. Show one question at a time, cheer when an answer is right, and show the score at the end with a “Try again” button.`,
  draw: ([extra]) =>
    `I drew a picture of what I want to build and added it to this message. It's a drawing I made, not a photo of anyone. Please build a page that looks like my drawing${extra ? `, and ${extra}` : ""}.`,
};

/**
 * The sentence the Builder text box opens with: the card's own sentence with the child's blanks
 * filled in (an empty blank is left out), then "Also add: ..." for the ticked parts (in the
 * recipe's order).
 */
export function recipeSentence(
  starterId: string,
  blanks: ReadonlyArray<string>,
  ticked: ReadonlyArray<{ readonly id: string; readonly amount?: number | undefined }>,
): string {
  const recipe = recipeFor(starterId);
  const build = CARD_SENTENCES[starterId];
  if (recipe === undefined || build === undefined) return "";
  const base = build(blanks.map((entry) => entry.trim()));
  const phrases = recipe.items.flatMap((entry) => {
    const hit = ticked.find((tick) => tick.id === entry.id);
    return hit === undefined ? [] : [itemPhrase(entry, hit.amount)];
  });
  return phrases.length === 0 ? base : `${base} Also add: ${listWords(phrases)}.`;
}

/** Whether a card has a recipe with a label for each of its blanks. */
export function hasRecipe(starterId: string): boolean {
  const starter = KID_STARTERS.find((entry) => entry.id === starterId);
  const recipe = recipeFor(starterId);
  return (
    starter !== undefined &&
    recipe !== undefined &&
    recipe.blanks.length === blankCount(starter.ask) &&
    recipe.items.length >= 6
  );
}
