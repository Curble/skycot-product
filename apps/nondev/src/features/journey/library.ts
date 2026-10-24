// The Build Journey's words: for each of the five maker steps and each reading level, what Sam
// is doing now, why makers do this step, and one "Your turn to think" question. Written by hand,
// offline and reviewed (docs/nondev/design-explorations/2026-10-25/build-journey/BRIEF.md has the
// approved "Test it" text). Little makers get one short sentence; Makers get the why and one real
// word; Big makers get how it works. Sam's name is filled in for the family's own crew.
import type { ReadingLevel } from "../family/children";
import type { JourneyStep } from "./steps";

export interface ThinkChoice {
  readonly label: string;
  readonly reply: string;
  /** The reply offers "Tell Sam", which sends the choice as the child's note. */
  readonly tellSam?: boolean;
}

export interface StepExplanation {
  readonly now: string;
  readonly why: string;
  readonly question: string;
  readonly answers: ReadonlyArray<ThinkChoice>;
}

type Copy = Record<ReadingLevel, StepExplanation>;

const LIBRARY: Record<JourneyStep, Copy> = {
  "Think it through": {
    "little-makers": {
      now: "Sam is thinking about your idea!",
      why: "Makers think first, so they make the right thing.",
      question: "How should it feel?",
      answers: [
        { label: "😄 Silly", reply: "Silly is great! Sam loves silly.", tellSam: true },
        { label: "😌 Calm", reply: "Calm and cosy. Lovely!", tellSam: true },
      ],
    },
    makers: {
      now: "Sam is reading your idea carefully and picturing what it could look like.",
      why: "Designers start by asking “what is this for, and who will use it?” before making anything.",
      question: "Who is this for?",
      answers: [
        { label: "Just me", reply: "Then it can be exactly how you like it!", tellSam: true },
        {
          label: "My friends",
          reply: "Good thinking: Sam can make it easy for anyone to try.",
          tellSam: true,
        },
      ],
    },
    "big-makers": {
      now: "Sam is working out what you asked for: the must-haves, the nice-to-haves, and anything that's unclear.",
      why: "Real teams write down requirements first, so everyone builds the same thing.",
      question: "Which matters most for this one?",
      answers: [
        {
          label: "Looks amazing",
          reply: "Then Sam will spend extra care on colours and layout.",
          tellSam: true,
        },
        {
          label: "Works perfectly",
          reply: "Then Sam will test it extra carefully.",
          tellSam: true,
        },
      ],
    },
  },
  "Make a plan": {
    "little-makers": {
      now: "Sam is making a list of steps!",
      why: "A plan is like a recipe for making things.",
      question: "What do you do first in a recipe?",
      answers: [
        { label: "📋 Read it", reply: "Yes! Reading the steps first helps.", tellSam: false },
        { label: "🍳 Start cooking", reply: "Ha! Reading first stops mistakes.", tellSam: false },
      ],
    },
    makers: {
      now: "Sam is writing a short plan: the steps it will take to build your idea, in order.",
      why: "Breaking a big job into small steps makes it easier, and you can check the plan before anything is built.",
      question: "Is there a step you'd add to the plan?",
      answers: [
        {
          label: "Add sounds",
          reply: "Nice idea! Tell Sam and it can add it to the plan.",
          tellSam: true,
        },
        {
          label: "It's perfect",
          reply: "Great! Press Build it when you're ready.",
          tellSam: false,
        },
      ],
    },
    "big-makers": {
      now: "Sam is turning your idea into a plan: the steps, the order they go in, and how it will check each one.",
      why: "Planning first is cheaper than fixing later. Engineers say an hour of planning saves ten hours of building.",
      question: "What could go wrong with this plan?",
      answers: [
        {
          label: "It's too big",
          reply: "Smart: you can ask Sam to start with a smaller first version.",
          tellSam: true,
        },
        {
          label: "Something's missing",
          reply: "Tell Sam what's missing and it will update the plan.",
          tellSam: true,
        },
      ],
    },
  },
  "Build it": {
    "little-makers": {
      now: "Sam is building your idea right now!",
      why: "Makers build one little piece at a time.",
      question: "What should be your favourite colour in it?",
      answers: [
        { label: "💙 Blue", reply: "Blue! Tell Sam and it can use it.", tellSam: true },
        { label: "💗 Pink", reply: "Pink! Tell Sam and it can use it.", tellSam: true },
      ],
    },
    makers: {
      now: "Sam is writing the code: the instructions that tell the computer what to draw and what to do when you play.",
      why: "Code is like a recipe the computer follows exactly, step by step, so every word matters.",
      question: "What should happen when you win?",
      answers: [
        { label: "Confetti!", reply: "Confetti is a classic. Tell Sam to add it.", tellSam: true },
        {
          label: "A big sound",
          reply: "A winning sound makes it feel real. Tell Sam!",
          tellSam: true,
        },
      ],
    },
    "big-makers": {
      now: "Sam is writing the page's code: HTML for what's on the page, CSS for how it looks, and JavaScript for how it behaves.",
      why: "Splitting the what, the look and the behaviour keeps code tidy, so one part can change without breaking the others.",
      question: "Which part would you change if the game was too easy?",
      answers: [
        {
          label: "The JavaScript",
          reply: "Right: the behaviour, like speed or rules, lives in the JavaScript.",
          tellSam: true,
        },
        {
          label: "The CSS",
          reply: "CSS changes the look, but the rules live in the JavaScript.",
          tellSam: false,
        },
      ],
    },
  },
  "Test it": {
    "little-makers": {
      now: "Sam is playing your game to check it works!",
      why: "Makers test things to find mistakes before anyone else does.",
      question: "What should Sam check first?",
      answers: [
        {
          label: "🐧 It moves",
          reply: "Great idea! If it can't move, nobody can play.",
          tellSam: true,
        },
        { label: "⭐ It's fun", reply: "Yes! Fun matters too.", tellSam: true },
      ],
    },
    makers: {
      now: "Sam is testing your work: checking each part does what you asked, like the buttons, the moves and the score.",
      why: "Testing is how makers find bugs (mistakes in the code) before players do. Real game studios have whole teams that only test!",
      question: "Sam found something that could be a bug. What should it do?",
      answers: [
        {
          label: "Fix it",
          reply: "Good call. Fixing bugs early is what good makers do.",
          tellSam: true,
        },
        {
          label: "Keep it, it's a secret!",
          reply: "Ha! Some famous game secrets started as bugs. Tell Sam if you want to keep it.",
          tellSam: true,
        },
      ],
    },
    "big-makers": {
      now: "Sam is running an automated test: a small program that tries your work by itself and checks the results are right.",
      why: "Automated tests let makers check everything again in seconds after every change, so new code doesn't break old code.",
      question: "What would a good test check in a game?",
      answers: [
        {
          label: "Winning gives points",
          reply: "Yes: test the rules, like the score going up when you win.",
          tellSam: true,
        },
        {
          label: "The colours",
          reply: "Colours are easy to see yourself; tests are best at checking rules.",
          tellSam: false,
        },
      ],
    },
  },
  Finish: {
    "little-makers": {
      now: "It's ready! Sam finished your idea!",
      why: "Makers share what they made. Show a grown-up!",
      question: "What do you want to do now?",
      answers: [
        { label: "▶️ Play it", reply: "Press Play it to try it!", tellSam: false },
        { label: "✏️ Change it", reply: "Tell Sam what to change.", tellSam: true },
      ],
    },
    makers: {
      now: "Sam has finished! Your work is saved, and you can go back to any earlier version.",
      why: "Makers keep improving: try it, notice what you'd change, and ask for one change at a time.",
      question: "What would make it even better?",
      answers: [
        { label: "A new level", reply: "Great idea! Ask Sam for a second level.", tellSam: true },
        { label: "It's perfect", reply: "Then show a grown-up what you made!", tellSam: false },
      ],
    },
    "big-makers": {
      now: "Sam has finished and checked the work. Every change is saved as a version, so nothing is lost if you try something new.",
      why: "Professional makers ship a first version, then improve it in small steps. That's called iterating.",
      question: "What's the next small step?",
      answers: [
        {
          label: "Make it harder",
          reply: "Try asking for one change, like a faster speed, then test it.",
          tellSam: true,
        },
        {
          label: "Share it",
          reply: "Press Show a grown-up to share what you made.",
          tellSam: false,
        },
      ],
    },
  },
};

export function explanationFor(
  step: JourneyStep,
  level: ReadingLevel,
  name = "Sam",
): StepExplanation {
  const copy = LIBRARY[step][level];
  const named = (text: string) => text.replaceAll("Sam", name);
  return {
    now: named(copy.now),
    why: named(copy.why),
    question: named(copy.question),
    answers: copy.answers.map((answer) => ({ ...answer, reply: named(answer.reply) })),
  };
}

export const BUILD_WORDS = [
  "test",
  "bug",
  "loop",
  "grid",
  "variable",
  "collision detection",
  "colour code",
  "click event",
  "score",
  "animation",
  "3D",
  "random",
  "if/then",
  "function",
  "file",
  "page",
  "style",
  "plan",
  "debug",
  "share",
] as const;
export type BuildWord = (typeof BUILD_WORDS)[number];

const WORD_COPY: Record<BuildWord, readonly [string, string, string]> = {
  test: [
    "Trying something to see if it works.",
    "A check that shows a part works the way you wanted.",
    "A small program that checks code gives the right answer, so it can be re-checked after every change.",
  ],
  bug: [
    "A little mistake that makes things go wrong.",
    "A mistake in the code that makes something go wrong. The first one was a real moth!",
    "A mistake in code. In 1947 engineers found a real moth stuck in a computer and taped it in their notebook.",
  ],
  loop: [
    "Doing the same thing again and again.",
    "Instructions that repeat, like drawing every star in the sky one after another.",
    "Code that repeats a block, such as a for loop that runs once for each item in a list.",
  ],
  grid: [
    "Lots of little squares in rows.",
    "Rows and columns of squares, like a chessboard. Mazes are often built on one.",
    "A layout of rows and columns; each square has an x (across) and y (down) position.",
  ],
  variable: [
    "A box with a name that holds something.",
    "A named place to keep a value, like score = 10.",
    "A named value the program can read and change while it runs, like let score = 0.",
  ],
  "collision detection": [
    "Noticing when two things bump.",
    "How a game knows two things are touching, like the penguin reaching the fish.",
    "How a game knows two things are touching: it checks whether their positions or shapes overlap.",
  ],
  "colour code": [
    "A secret code for a colour.",
    "A code that names a colour, like #FF0000 for red.",
    "A hex code like #FF8800 that mixes red, green and blue light, two characters each.",
  ],
  "click event": [
    "When the computer notices your tap.",
    "A message the page gets when you click, so it can do something.",
    "An event the browser fires on a click; code listens for it with addEventListener.",
  ],
  score: [
    "Points you win in a game.",
    "A number that goes up when you do well, kept in a variable.",
    "A variable the game updates when rules are met, like score += 10.",
  ],
  animation: [
    "Pictures that look like they move.",
    "Lots of slightly different pictures shown fast, so things look like they move.",
    "Changing what's drawn many times a second (often 60) so motion looks smooth.",
  ],
  "3D": [
    "A shape you can see all the way round.",
    "Things with width, height and depth, so you can spin and look around them.",
    "Shapes with x, y and z positions, drawn from a camera's point of view.",
  ],
  random: [
    "A surprise the computer picks.",
    "A choice the computer makes by chance, like rolling a dice.",
    "A value picked unpredictably, like Math.random() giving a number between 0 and 1.",
  ],
  "if/then": [
    "If this happens, then do that!",
    "A choice in code: if the penguin reaches the fish, then add points.",
    "A condition: code that only runs when something is true, written as if (...) { ... }.",
  ],
  function: [
    "A set of steps with a name.",
    "A named group of instructions you can use again and again.",
    "A reusable block of code with a name, which can take inputs and give back a result.",
  ],
  file: [
    "A saved piece of your work.",
    "One saved part of a project, like a page or a picture.",
    "A named piece of data on disk; a website is usually several files working together.",
  ],
  page: [
    "A screen you can open and look at.",
    "A web page: what you see in the browser, made with HTML.",
    "An HTML document the browser reads to build what you see, with CSS and JavaScript attached.",
  ],
  style: [
    "How something looks.",
    "Rules for colours, sizes and where things go on the page.",
    "CSS: rules that pick parts of a page and set how they look, like color: blue.",
  ],
  plan: [
    "A list of steps before you make something.",
    "The steps a maker writes down before building, in order.",
    "An ordered outline of the work, checked before building starts.",
  ],
  debug: [
    "Finding a mistake and fixing it.",
    "Hunting down a bug and fixing it, like a detective.",
    "Finding a bug's cause by testing ideas one at a time, then fixing it.",
  ],
  share: [
    "Showing what you made to someone.",
    "Letting someone else see and try what you made.",
    "Publishing work so others can use it, and getting feedback to improve it.",
  ],
};

export function wordFor(
  word: BuildWord,
  level: ReadingLevel,
): { readonly word: BuildWord; readonly meaning: string } {
  const index = level === "little-makers" ? 0 : level === "makers" ? 1 : 2;
  return { word, meaning: WORD_COPY[word][index] };
}

/**
 * The word this build teaches: the most interesting idea the build actually used. The specific
 * game ideas come first, because every build makes a page and almost every build has a style.
 */
const WORD_CLUES: ReadonlyArray<readonly [BuildWord, RegExp]> = [
  ["collision detection", /collision|collide|overlap|hitbox|intersect/],
  ["3D", /three(?:\.js|\.module)?|webgl|perspectivecamera|\b3d\b/],
  ["random", /math\.random|random/],
  ["animation", /requestanimationframe|@keyframes|animation|animate/],
  ["score", /score|points/],
  ["loop", /\bfor\s*\(|\bwhile\s*\(|\.foreach\(/],
  ["click event", /addeventlistener\(\s*["'](?:click|pointerdown|keydown)|onclick/],
  ["grid", /grid|maze|rows|columns/],
  ["colour code", /#[0-9a-f]{6}\b/],
  ["if/then", /\bif\s*\(/],
  ["test", /\btest\b|assert|check/],
  ["function", /\bfunction\b|=>/],
  ["variable", /\b(?:let|const|var)\s+\w+/],
  ["style", /\.css\b|<style|color:/],
  ["page", /\.html\b/],
];

export function chooseBuildWord(input: {
  readonly fileNames?: ReadonlyArray<string>;
  readonly commands?: ReadonlyArray<string>;
  readonly changedCode?: string;
}): BuildWord {
  const clues = [
    input.fileNames?.join(" ") ?? "",
    input.commands?.join(" ") ?? "",
    input.changedCode ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return WORD_CLUES.find(([, pattern]) => pattern.test(clues))?.[0] ?? "plan";
}

/**
 * Up to three real lines from the child's own project that show the build's word (for Big
 * makers' code peek); null when none match, so nothing made-up is ever shown.
 */
export function codePeekFor(changedCode: string, word: BuildWord): ReadonlyArray<string> | null {
  const pattern = WORD_CLUES.find(([candidate]) => candidate === word)?.[1];
  if (pattern === undefined) return null;
  const lines = changedCode.split("\n");
  const at = lines.findIndex((line) => pattern.test(line.toLowerCase()));
  if (at === -1) return null;
  const peek = lines
    .slice(at, at + 3)
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.length > 70 ? `${line.slice(0, 69)}…` : line));
  if (peek.length === 0) return null;
  const indent = Math.min(...peek.map((line) => /^\s*/u.exec(line)![0].length));
  return peek.map((line) => line.slice(indent));
}
