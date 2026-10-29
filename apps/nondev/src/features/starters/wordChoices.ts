// Word chips for the Words level of build help (WordsSheet.tsx): for every kids' card with
// blanks, two or three steps of chips, and a sentence that builds live as the child taps.
// Pure data and string building, tested in wordChoices.test.ts. Blank steps reuse the card's
// picture choices (choices.ts) as chips, so the Words level can never ask for less than the
// card does; extra steps ("Where does it happen?", "Add a twist?") only ever add to the
// sentence. Every plan's `template` is the card's own sentence with a `{name}` where each
// blank or extra goes, so the finished sentence still reads as the card's (the hidden marker
// that tells the engine which card it was still applies, see `stillFromStarter`). Chips are
// written the way they read inside the sentence, lower case, and never mention ages.

import { blankCount, choicesFor, type BlankChoice } from "./choices";
import { KID_STARTERS } from "./starters";

/** The most chips a twist can take: pick one or two. */
export const TWIST_MAX = 2;

export type WordGroup =
  | {
      /** Fills the card's own `[blank]` number `blankIndex`; chips come from choices.ts. */
      readonly kind: "blank";
      readonly blankIndex: number;
      /** What the live sentence shows before the child has picked, like "your game". */
      readonly placeholder: string;
    }
  | {
      /** Adds to the sentence. `phrase` has a `{}` where the chosen words go. */
      readonly kind: "extra";
      readonly slot: string;
      readonly question: string;
      readonly chips: ReadonlyArray<BlankChoice>;
      readonly phrase: string;
      /** What the sentence says when nothing is picked; empty leaves the slot out. */
      readonly fallback?: string;
      /** How many chips may be on at once. */
      readonly max: number;
    };

export interface WordStep {
  /** The sheet's title for this step. */
  readonly title: string;
  readonly groups: ReadonlyArray<WordGroup>;
  /** The "Add a twist?" step: always optional, with a "No twist, thanks" chip. */
  readonly twist?: boolean;
}

export interface WordsPlan {
  readonly starterId: string;
  /** The card's sentence with `{b0}`, `{b1}` for its blanks and `{slot}` for each extra. */
  readonly template: string;
  readonly steps: ReadonlyArray<WordStep>;
}

const chips = (pairs: ReadonlyArray<readonly [art: string, label: string]>) =>
  pairs.map(([art, label]) => ({ art, label }));

function twist(pairs: ReadonlyArray<readonly [art: string, label: string]>): WordStep {
  return {
    title: "Add a twist?",
    twist: true,
    groups: [
      {
        kind: "extra",
        slot: "twist",
        question: "Add a twist",
        chips: chips(pairs),
        phrase: " Add a twist: {}.",
        max: TWIST_MAX,
      },
    ],
  };
}

function extra(
  slot: string,
  question: string,
  phrase: string,
  pairs: ReadonlyArray<readonly [art: string, label: string]>,
  options: { readonly max?: number; readonly fallback?: string } = {},
): WordGroup {
  return {
    kind: "extra",
    slot,
    question,
    chips: chips(pairs),
    phrase,
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    max: options.max ?? 1,
  };
}

const blankGroup = (blankIndex: number, placeholder: string): WordGroup => ({
  kind: "blank",
  blankIndex,
  placeholder,
});

export const WORD_PLANS: ReadonlyArray<WordsPlan> = [
  {
    starterId: "game",
    template:
      "Please make a simple game I can play in the page: {b0}{place}. Use {controls}, keep score, and show a big “Play again” button at the end.{twist}",
    steps: [
      { title: "What kind of game?", groups: [blankGroup(0, "your game")] },
      {
        title: "Where, and how?",
        groups: [
          extra("place", "Where does it happen?", ", {}", [
            ["🚀", "set in space"],
            ["🌊", "under the sea"],
            ["🏰", "in a spooky castle"],
            ["🍭", "in a candy land"],
            ["🚜", "on a farm"],
            ["🌴", "in the jungle"],
          ]),
          extra(
            "controls",
            "How do you play?",
            "{}",
            [
              ["⌨️", "the arrow keys"],
              ["🖱️", "the mouse"],
              ["👆", "my finger to tap"],
            ],
            { fallback: "the arrow keys or the mouse" },
          ),
        ],
      },
      twist([
        ["⚡", "it gets faster and faster"],
        ["🎁", "a secret bonus appears"],
        ["🔊", "funny sounds"],
        ["👻", "a friendly ghost pops up"],
        ["🙃", "everything flips upside down"],
        ["🎆", "a surprise ending"],
      ]),
    ],
  },
  {
    starterId: "pet",
    template:
      "Please make a page all about my pet, a {b0} called {b1}.{trait} Draw them big using shapes, add three fun facts, and a button that makes them say hello.{twist}",
    steps: [
      {
        title: "Who is your pet?",
        groups: [blankGroup(0, "animal"), blankGroup(1, "name")],
      },
      {
        title: "What are they like?",
        groups: [
          extra(
            "trait",
            "What are they like?",
            " They are {}.",
            [
              ["🤗", "very cuddly"],
              ["🏃", "super speedy"],
              ["😴", "always sleepy"],
              ["🤪", "totally silly"],
              ["🍖", "always hungry"],
              ["🦸", "a little bit brave"],
            ],
            { max: 2 },
          ),
        ],
      },
      twist([
        ["🎩", "they wear a tiny hat"],
        ["🕶️", "they wear cool sunglasses"],
        ["⭐", "a secret superpower"],
        ["🎵", "a happy dance"],
        ["🌈", "a rainbow background"],
        ["💬", "they say something new each time"],
      ]),
    ],
  },
  {
    starterId: "birthday",
    template:
      "Please make a birthday card page for {b0}, who is turning {b1}.{colours} Make it bright and happy with balloons, a big “Happy birthday!”, and a button that makes confetti pop.{twist}",
    steps: [
      {
        title: "Who is it for?",
        groups: [blankGroup(0, "someone special"), blankGroup(1, "a number")],
      },
      {
        title: "What should it look like?",
        groups: [
          extra("colours", "What should it look like?", " Use lots of {}.", [
            ["💖", "pink and sparkles"],
            ["🌈", "rainbow colours"],
            ["🚀", "stars and space"],
            ["🦄", "unicorn colours"],
            ["🌊", "cool blues"],
            ["☀️", "sunshine yellow"],
          ]),
        ],
      },
      twist([
        ["🎁", "a gift box you can open"],
        ["🎂", "candles you can blow out"],
        ["🎆", "fireworks at the end"],
        ["🔊", "a happy sound when you press the button"],
        ["🎈", "balloons that float up"],
        ["💌", "a secret message appears"],
      ]),
    ],
  },
  {
    starterId: "school",
    template:
      "Please make a one-page project about {b0}. Give it a title, three short sections with headings, a simple diagram drawn with shapes, and a five-question quiz at the end.{look}{twist}",
    steps: [
      { title: "What is it about?", groups: [blankGroup(0, "your topic")] },
      {
        title: "How should it look?",
        groups: [
          extra("look", "How should it look?", " Make it look {}.", [
            ["🪧", "like a poster"],
            ["📓", "like a notebook"],
            ["🏛️", "like a museum sign"],
            ["🎨", "bright and colourful"],
            ["✨", "clean and neat"],
          ]),
        ],
      },
      twist([
        ["💡", "a “Did you know?” box"],
        ["🔘", "a fun fact button"],
        ["🎉", "confetti for a perfect quiz score"],
        ["🖼️", "a big, cool title picture"],
        ["🔍", "words that pop up when you point at them"],
        ["🧠", "a brain-teaser at the end"],
      ]),
    ],
  },
  {
    starterId: "comic",
    template:
      "Please make a four-panel comic strip about {b0}.{place}{mood} Draw the characters with simple shapes and put the words in speech bubbles.{twist}",
    steps: [
      { title: "What happens?", groups: [blankGroup(0, "what happens")] },
      {
        title: "Where, and how does it feel?",
        groups: [
          extra("place", "Where does it happen?", " Set it {}.", [
            ["🚀", "in space"],
            ["🏖️", "at the beach"],
            ["🏫", "at school"],
            ["🌲", "in a forest"],
            ["🏰", "in a castle"],
            ["⛄", "in the snow"],
          ]),
          extra("mood", "How does it feel?", " Make it {}.", [
            ["😂", "really funny"],
            ["👻", "a bit spooky"],
            ["🤩", "exciting"],
            ["🥰", "sweet and kind"],
          ]),
        ],
      },
      twist([
        ["💥", "big POW and BOOM words"],
        ["🦸", "a surprise hero"],
        ["🤣", "a silly joke at the end"],
        ["🌈", "colourful backgrounds"],
        ["😮", "a big surprise in the last panel"],
        ["💭", "a thought bubble"],
      ]),
    ],
  },
  {
    starterId: "quiz",
    template:
      "Please make a quiz with {b0} questions about {b1}.{level} Show one question at a time, cheer when an answer is right, and show the score at the end with a “Try again” button.{twist}",
    steps: [
      {
        title: "How many, and about what?",
        groups: [blankGroup(0, "how many"), blankGroup(1, "your topic")],
      },
      {
        title: "How hard should it be?",
        groups: [
          extra("level", "How hard should it be?", " Make the questions {}.", [
            ["😎", "easy peasy"],
            ["🤔", "a little tricky"],
            ["🧠", "really tricky"],
            ["🎲", "a mix of easy and tricky"],
          ]),
        ],
      },
      twist([
        ["⭐", "a gold star for every right answer"],
        ["⏱️", "a timer for each question"],
        ["🎉", "confetti for a perfect score"],
        ["🤣", "a funny message when you get one wrong"],
        ["🔊", "happy sounds"],
        ["🏆", "a trophy at the end"],
      ]),
    ],
  },
  {
    starterId: "draw",
    template:
      "I drew a picture of what I want to build and added it to this message. It's a drawing I made, not a photo of anyone. Please build a page that looks like my drawing, and {b0}.{colours}{twist}",
    steps: [
      { title: "Anything extra?", groups: [blankGroup(0, "anything extra")] },
      {
        title: "What colours?",
        groups: [
          extra("colours", "What colours?", " Make the colours {}.", [
            ["🌟", "extra bright"],
            ["🌸", "soft and dreamy"],
            ["🌑", "dark and spooky"],
            ["🍬", "sweet like candy"],
          ]),
        ],
      },
      twist([
        ["🌙", "a button that switches day and night"],
        ["🔊", "friendly sounds when I click"],
        ["🕵️", "something hiding in a corner"],
        ["✨", "sparkles everywhere"],
        ["🐾", "a little friend who walks across"],
        ["🎆", "a surprise when I click the middle"],
      ]),
    ],
  },
];

/** The Words plan for a card, or undefined if the card has none (it has no blanks). */
export function wordsPlanFor(starterId: string): WordsPlan | undefined {
  return WORD_PLANS.find((plan) => plan.starterId === starterId);
}

/** The key a group's answer is kept under: `b0` for a blank, the slot name for an extra. */
export function groupKey(group: WordGroup): string {
  return group.kind === "blank" ? `b${group.blankIndex}` : group.slot;
}

/** The question and chips a group shows (a blank's come from the card's picture choices). */
export function groupContent(
  starterId: string,
  group: WordGroup,
): { readonly question: string; readonly chips: ReadonlyArray<BlankChoice> } {
  if (group.kind === "extra") return { question: group.question, chips: group.chips };
  const found = choicesFor(starterId).find((entry) => entry.blankIndex === group.blankIndex);
  return { question: found?.question ?? "", chips: found?.choices ?? [] };
}

export type Answers = Readonly<Record<string, ReadonlyArray<string>>>;

/** One piece of the live sentence; `group` says which group's words it is, for the colours. */
export interface Segment {
  readonly text: string;
  readonly group?: string;
}

/** "a", "a and b", "a, b and c". */
export function joinWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function allGroups(plan: WordsPlan): ReadonlyArray<WordGroup> {
  return plan.steps.flatMap((step) => step.groups);
}

/**
 * The sentence in pieces. With `placeholders`, a blank nobody has filled shows its placeholder
 * ("your game") so the live sentence always reads; without, it is left as the card's `[blank]`
 * text-free hole (the caller only sends once every blank has an answer).
 */
export function wordsSegments(
  plan: WordsPlan,
  answers: Answers,
  placeholders: boolean,
): ReadonlyArray<Segment> {
  const groups = new Map(allGroups(plan).map((group) => [groupKey(group), group] as const));
  const out: Segment[] = [];
  for (const part of plan.template.split(/(\{[a-z0-9]+\})/)) {
    const match = /^\{([a-z0-9]+)\}$/.exec(part);
    if (match === null) {
      if (part !== "") out.push({ text: part });
      continue;
    }
    const key = match[1]!;
    const group = groups.get(key);
    if (group === undefined) continue;
    const picked = answers[key] ?? [];
    if (group.kind === "blank") {
      const text = picked[0] ?? (placeholders ? group.placeholder : "");
      if (text !== "") out.push({ text, group: key });
      continue;
    }
    if (picked.length === 0) {
      if (group.fallback !== undefined && group.fallback !== "") out.push({ text: group.fallback });
      continue;
    }
    const [before, after] = group.phrase.split("{}") as [string, string];
    if (before !== "") out.push({ text: before });
    out.push({ text: joinWords(picked), group: key });
    if (after !== "") out.push({ text: after });
  }
  return out;
}

/** The finished sentence to send: every blank answered, extras where the child chose them. */
export function wordsSentence(plan: WordsPlan, answers: Answers): string {
  return wordsSegments(plan, answers, false)
    .map((segment) => segment.text)
    .join("");
}

/** The blank groups still waiting for an answer. */
export function unansweredBlanks(plan: WordsPlan, answers: Answers): ReadonlyArray<string> {
  return allGroups(plan).flatMap((group) =>
    group.kind === "blank" && (answers[groupKey(group)] ?? []).length === 0
      ? [groupKey(group)]
      : [],
  );
}

/** Whether a card has a Words plan covering every one of its blanks. */
export function hasWords(starterId: string): boolean {
  const starter = KID_STARTERS.find((entry) => entry.id === starterId);
  const plan = wordsPlanFor(starterId);
  if (starter === undefined || plan === undefined) return false;
  const covered = new Set(
    allGroups(plan).flatMap((group) => (group.kind === "blank" ? [group.blankIndex] : [])),
  );
  return Array.from({ length: blankCount(starter.ask) }, (_, i) => i).every((i) => covered.has(i));
}
