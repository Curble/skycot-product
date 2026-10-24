// One-tap starter cards: the words a card puts in the message box. Pure data and string
// building, so the prompts are tested and the cards stay dumb. Every kid prompt asks for one
// small, offline, single-file page in the current project: one file is what the What-changed
// card can open in its preview (features/starters/PreviewSheet.tsx), and "offline, no installs"
// is what the Family profile's engine rules ask for anyway, so the request never starts a fight
// with them. Blanks are written `[like this]`; the composer selects the first one so a child
// can type straight over it.

export type StarterAudience = "kids" | "grown-ups";

/** What tapping the card does beyond filling the box. */
export type StarterKind = "prompt" | "picture" | "surprise";

/** Icon keys, mapped to lucide glyphs in StarterCards.tsx so this file stays pure. */
export type StarterIcon =
  | "game"
  | "pet"
  | "cake"
  | "school"
  | "comic"
  | "quiz"
  | "draw"
  | "surprise"
  | "form"
  | "price"
  | "typo"
  | "hours"
  | "phone"
  | "gallery"
  | "about"
  | "polish";

export type StarterTone = "orange" | "blue" | "green" | "purple" | "red" | "yellow";

export interface Starter {
  readonly id: string;
  readonly audience: StarterAudience;
  readonly kind: StarterKind;
  readonly title: string;
  /** One short line under the title, in the reader's words. */
  readonly blurb: string;
  readonly icon: StarterIcon;
  readonly tone: StarterTone;
  /** The ask, with `[blanks]`; the shared rules are appended by `starterPrompt`. */
  readonly ask: string;
  /** Kids' cards name the one file the page goes in, so "Open it" has one thing to open. */
  readonly fileName?: string;
}

/** Appended to every kid prompt: one file, offline, nothing to install. */
export function kidRules(fileName: string): string {
  return [
    `Make it one new file called ${fileName}, with the HTML, CSS and JavaScript all inside that one file.`,
    "It must work offline: no internet, no installs, and no pictures, sounds or fonts from websites (draw with CSS, SVG or emoji).",
    "Then tell me in one short, friendly sentence what you made.",
  ].join(" ");
}

/** Appended to every grown-up prompt: the files already here, nothing new to install. */
export const GROWN_UP_RULES =
  "Keep it simple: plain HTML, CSS and JavaScript in the files that are already here. No installs, no new tools, and nothing that needs the internet to work. Show me a short plan before you change anything.";

export const KID_STARTERS: ReadonlyArray<Starter> = [
  {
    id: "game",
    audience: "kids",
    kind: "prompt",
    title: "Make a game",
    blurb: "Something you can play right away",
    icon: "game",
    tone: "orange",
    fileName: "my-game.html",
    ask: "Please make a simple game I can play in the page: [what kind of game — like “catch the falling stars” or “a maze”]. Use the arrow keys or the mouse, keep score, and show a big “Play again” button at the end.",
  },
  {
    id: "pet",
    audience: "kids",
    kind: "prompt",
    title: "A page about my pet",
    blurb: "Fun facts and a big drawing",
    icon: "pet",
    tone: "green",
    fileName: "my-pet.html",
    ask: "Please make a page all about my pet, a [kind of animal] called [pet's name]. Draw them big using shapes, add three fun facts, and a button that makes them say hello.",
  },
  {
    id: "birthday",
    audience: "kids",
    kind: "prompt",
    title: "A birthday card",
    blurb: "Balloons, a big hello, confetti",
    icon: "cake",
    tone: "red",
    fileName: "birthday-card.html",
    ask: "Please make a birthday card page for [who it's for — like “my Nan” or “my best friend”], who is turning [age]. Make it bright and happy with balloons, a big “Happy birthday!”, and a button that makes confetti pop.",
  },
  {
    id: "school",
    audience: "kids",
    kind: "prompt",
    title: "My school project",
    blurb: "Headings, a diagram and a quiz",
    icon: "school",
    tone: "blue",
    fileName: "my-project.html",
    ask: "Please make a one-page project about [my topic — like volcanoes or the planets]. Give it a title, three short sections with headings, a simple diagram drawn with shapes, and a five-question quiz at the end.",
  },
  {
    id: "comic",
    audience: "kids",
    kind: "prompt",
    title: "A comic strip",
    blurb: "Four panels and speech bubbles",
    icon: "comic",
    tone: "purple",
    fileName: "my-comic.html",
    ask: "Please make a four-panel comic strip about [what happens — like “a cat who wants to fly”]. Draw the characters with simple shapes and put the words in speech bubbles.",
  },
  {
    id: "quiz",
    audience: "kids",
    kind: "prompt",
    title: "A quiz for my friends",
    blurb: "One question at a time",
    icon: "quiz",
    tone: "yellow",
    fileName: "my-quiz.html",
    ask: "Please make a quiz with [5] questions about [the topic]. Show one question at a time, cheer when an answer is right, and show the score at the end with a “Try again” button.",
  },
  {
    id: "draw",
    audience: "kids",
    kind: "picture",
    title: "Draw it, then build it",
    blurb: "Add a picture of your drawing",
    icon: "draw",
    tone: "blue",
    fileName: "my-drawing.html",
    ask: "I drew a picture of what I want to build and added it to this message. It's a drawing I made, not a photo of anyone. Please build a page that looks like my drawing, and [anything extra — like “make the sun spin when I click it”].",
  },
  {
    id: "surprise",
    audience: "kids",
    kind: "surprise",
    title: "Surprise me",
    blurb: "SKYCOT picks something fun",
    icon: "surprise",
    tone: "orange",
    fileName: "surprise.html",
    ask: "Surprise me! Please make {idea}.",
  },
];

/** "Surprise me" picks one of these; each is small, offline and needs no files. */
export const SURPRISE_IDEAS: ReadonlyArray<string> = [
  "a garden page where every click plants a different flower",
  "a pretend aquarium where fish swim over to wherever I click",
  "a big dice I can roll with a button, with a little rolling wobble",
  "a night sky where I click to add stars and join them into my own constellations",
  "a drum pad I can play with the keyboard, making its own sounds",
  "a page that tells a different silly joke every time I press the button",
  "a magic 8-ball that answers my questions",
];

export const GROWN_UP_STARTERS: ReadonlyArray<Starter> = [
  {
    id: "contact-form",
    audience: "grown-ups",
    kind: "prompt",
    title: "Add a contact form",
    blurb: "Name, email, message",
    icon: "form",
    tone: "blue",
    ask: "Add a simple contact form to [which page — like the home page]: name, email and message, with friendly checks before it sends. It doesn't need to send anywhere yet — show a thank-you note, and tell me what's needed to make it really send.",
  },
  {
    id: "price-list",
    audience: "grown-ups",
    kind: "prompt",
    title: "Make a price list",
    blurb: "A tidy table that works on phones",
    icon: "price",
    tone: "green",
    ask: "Make a clean price list page for [what you sell], with [how many] items in a tidy table that also reads well on a phone.",
  },
  {
    id: "typo",
    audience: "grown-ups",
    kind: "prompt",
    title: "Fix a typo everywhere",
    blurb: "Every page, in one go",
    icon: "typo",
    tone: "orange",
    ask: "Find every place the website says [the wrong spelling] and change it to [the right spelling]. Show me the list of pages you changed.",
  },
  {
    id: "hours",
    audience: "grown-ups",
    kind: "prompt",
    title: "Add opening hours",
    blurb: "With today's hours highlighted",
    icon: "hours",
    tone: "purple",
    ask: "Add our opening hours to [which page]: [days and times]. Make today's hours stand out.",
  },
  {
    id: "phones",
    audience: "grown-ups",
    kind: "prompt",
    title: "Make it work on phones",
    blurb: "Nothing too wide or too small",
    icon: "phone",
    tone: "blue",
    ask: "Check that every page reads well on a phone screen, and fix anything that is too wide, too small or overlapping. Tell me what you changed.",
  },
  {
    id: "gallery",
    audience: "grown-ups",
    kind: "prompt",
    title: "Add a photo gallery",
    blurb: "A neat grid, bigger on click",
    icon: "gallery",
    tone: "red",
    ask: "Add a gallery page that shows the pictures in [which folder] in a neat grid, with a bigger view when you click one.",
  },
  {
    id: "about",
    audience: "grown-ups",
    kind: "prompt",
    title: "Write an About page",
    blurb: "Short, warm, in your style",
    icon: "about",
    tone: "yellow",
    ask: "Write a short, warm About page for [the business name]: who we are, what we do, and how to get in touch. Keep it to three short paragraphs and match the style of the other pages.",
  },
  {
    id: "polish",
    audience: "grown-ups",
    kind: "prompt",
    title: "Suggest a polish",
    blurb: "Three small improvements",
    icon: "polish",
    tone: "green",
    ask: "Look over the site and suggest three small improvements that would make it look more polished.",
  },
];

/**
 * Kids' cards for a Family profile or a playful theme (Workshop); the business set for the
 * calm themes (Classic, Paper, Night Ops).
 */
export function startersFor(options: {
  readonly family: boolean;
  readonly playful: boolean;
}): ReadonlyArray<Starter> {
  return options.family || options.playful ? KID_STARTERS : GROWN_UP_STARTERS;
}

/** `random` is injectable so "Surprise me" is testable; it must return [0, 1). */
export function starterPrompt(starter: Starter, random: () => number = Math.random): string {
  const ask =
    starter.kind === "surprise" ? starter.ask.replace("{idea}", pickSurprise(random)) : starter.ask;
  const rules =
    starter.audience === "kids" ? kidRules(starter.fileName ?? "my-page.html") : GROWN_UP_RULES;
  return `${ask}\n\n${rules}`;
}

export function pickSurprise(random: () => number): string {
  const index = Math.min(
    SURPRISE_IDEAS.length - 1,
    Math.max(0, Math.floor(random() * SURPRISE_IDEAS.length)),
  );
  return SURPRISE_IDEAS[index]!;
}

/** The first `[blank]` in a prompt, brackets included, for the composer to select. */
export function firstBlank(text: string): { readonly start: number; readonly end: number } | null {
  const match = /\[[^\]\n]+\]/.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
