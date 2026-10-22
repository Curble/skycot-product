// nondev-seam: skycot-rules-package
// The personal-details shield. Before a child's message leaves the Mac, SKYCOT looks for the
// things a child should not hand an AI: a full name, a school, where they live, a phone
// number, an email, a birthday, a password. The plain client runs it before sending and
// offers nicknames; the engine runs the same function on every Family turn and hides what it
// finds before the provider sees it. Pure string heuristics, no network, Hermes-safe (no
// lookbehind, no regexp `d` flag, no Unicode property escapes).
//
// Tuned for a child's typing (often all lower case) and for stories and maths: a first name
// on its own, a planet, "Main Street" in a story and "123" in a sum are not personal details.
// A false catch costs one tap on "Use nicknames"; a miss sends a child's details away.

export type PersonalCategory =
  | "full-name"
  | "school"
  | "address"
  | "phone"
  | "email"
  | "birthday"
  | "login"
  | "photo";

/** Categories the text detector can find; a photo is asked about, never detected. */
export type TextPersonalCategory = Exclude<PersonalCategory, "photo">;

export interface PersonalCategoryInfo {
  readonly id: PersonalCategory;
  /** "a full name", for "That looks like a full name and a school." */
  readonly noun: string;
}

export const PERSONAL_CATEGORIES: ReadonlyArray<PersonalCategoryInfo> = [
  { id: "full-name", noun: "a full name" },
  { id: "school", noun: "a school's name" },
  { id: "address", noun: "where someone lives" },
  { id: "phone", noun: "a phone number" },
  { id: "email", noun: "an email address" },
  { id: "birthday", noun: "a birthday" },
  { id: "login", noun: "a password or username" },
  { id: "photo", noun: "a photo of a person" },
];

const NOUN: ReadonlyMap<PersonalCategory, string> = new Map(
  PERSONAL_CATEGORIES.map((info) => [info.id, info.noun]),
);

export interface PersonalDetail {
  readonly category: TextPersonalCategory;
  /** Offsets into the checked text: `text.slice(start, end)` is the detail. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The friendly stand-in: "Ava" for "Ava Smith", "school" for a school's name. */
  readonly suggestion: string;
}

// ── Word lists ────────────────────────────────────────────────────────────────────────────

/** Common given names (Australia first, then the wider English-speaking world). */
const GIVEN_NAMES = new Set(
  (
    "aaliyah aaron abigail adam addison adelaide aiden aisha alana alex alexander alexandra " +
    "alfie ali alice alicia alyssa amber amelia amelie amir amy ana ananya andrew angus anna " +
    "annabelle archer archie aria ariana arlo arthur arjun asher ashley audrey aurora austin " +
    "ava axel beatrice beau bella ben benjamin billie blake bonnie brianna brodie brooke " +
    "caleb cameron carlos caroline carter charles charlie charlotte chloe chris christopher " +
    "claire clara connor cooper daisy daniel darcy david diego dominic dylan edward eleanor " +
    "elena eli elijah elise eliza elizabeth ella ellie elsie emily emma eric erin ethan eva " +
    "evelyn evie ezra fatima felix finn fletcher flynn frankie freya gabriel gemma george " +
    "georgia grace hamish hannah harley harper harrison harry harvey hayden hayley hazel " +
    "heidi henry holly hudson hugo hunter imogen indi isaac isabel isabella isla ivy jack " +
    "jackson jacob jade jake james jasmine jasper jayden jennifer jessica joe john jonah " +
    "jordan joseph josh joshua jude julia julian kai kate katie kayla kevin kian kyle " +
    "lachlan laura lauren layla leah leo levi liam lily lincoln lola louis lucas lucia lucy " +
    "luka luke luna lydia mackenzie maddison madeleine madison maria mark marcus mason " +
    "mateo matilda matthew max maya mia michael mila miles millie mohammed molly muhammad " +
    "naomi nate nathan nicholas nicole nina noah oliver olivia omar oscar owen paige patrick " +
    "paul penelope peter phoebe piper poppy priya quinn rachel raj rebecca riley rohan rory " +
    "rose ruby ryan sadie samantha samuel sara sarah savannah scarlett sebastian sienna " +
    "sofia sophia sophie stella steve steven summer tahlia tara taylor thea theo theodore " +
    "thomas tim toby tom tyler violet wei william willow xavier zac zachary zara zoe zoey"
  ).split(" "),
);

/** Common surnames, so a lower-case "ava smith" after "I'm" still reads as a name. */
const SURNAMES = new Set(
  (
    "smith jones williams brown wilson taylor johnson white martin anderson thompson nguyen " +
    "thomas walker harris lee ryan robinson kelly king davis wright evans roberts green hall " +
    "wood jackson clarke patel khan singh chen wang li zhang liu murphy obrien mitchell " +
    "campbell young scott miller moore allen clark lewis hill baker adams nelson carter " +
    "turner phillips parker collins edwards stewart morris cook rogers morgan cooper peterson " +
    "bailey reed kim garcia martinez rodriguez lopez hernandez gonzalez tran pham le hughes"
  ).split(" "),
);

/** Capitalised words that follow a first name without being a surname ("Rose Garden"). */
const NOT_SURNAMES = new Set(
  (
    "and or but the a an is was are were has have had will can could would should says said " +
    "likes loves went wants made make makes plays played gets got also too then so if when " +
    "who what where why how my your his her our their its this that these those here there " +
    "to of in on at for with from by as up down out over into onto very really just " +
    "street st road rd avenue ave lane drive dr court place way close parade crescent " +
    "terrace highway grove circuit square boulevard " +
    "school primary college academy grammar kinder kindergarten high elementary " +
    "park garden gardens beach bay hill hills river lake island tree trees forest city town " +
    "village mountain valley church hall house hotel cafe shop store club team mode level " +
    "game games world land day days night time party cake show story book page button " +
    "colour color red blue green yellow pink purple orange black white gold silver eyes " +
    "league chain slippers speed power holiday holidays christmas easter birthday " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april " +
    "may june july august september october november december"
  ).split(" "),
);

/** Made-up and famous people a story or school project names on purpose. */
const WELL_KNOWN_NAMES = new Set(
  (
    "harry potter|hermione granger|ron weasley|peter pan|peter rabbit|george pig|mickey mouse|" +
    "minnie mouse|luke skywalker|jack frost|mary poppins|elsa arendelle|taylor swift|" +
    "isaac newton|charles darwin|steve irwin|mark twain|thomas edison|william shakespeare|" +
    "george washington|marie curie|grace hopper|james cook|ada lovelace"
  ).split("|"),
);

/** Places that are not where a child lives. */
const NOT_HOMES = new Set(
  (
    "mars|the moon|moon|jupiter|saturn|venus|mercury|neptune|uranus|pluto|space|outer space|" +
    "narnia|hogwarts|minecraft|roblox|fortnite|neverland|atlantis|wonderland|the north pole|" +
    "north pole|australia|new zealand|england|scotland|wales|ireland|the uk|uk|britain|" +
    "america|the usa|usa|the us|canada|india|china|japan|europe|asia|africa|the world|" +
    "earth|a house|a castle|a tree|a cave"
  ).split("|"),
);

/** Words that start a generic school ("Art School", "Hogwarts School") rather than a real one. */
const GENERIC_SCHOOL_WORDS = new Set(
  (
    "the a an my our your his her their this that art music dance driving old summer sunday " +
    "swim swimming coding cooking magic wizard wizarding ninja hogwarts primary high middle " +
    "every public private big new next local boarding night secret space dragon monster " +
    "superhero spy pirate robot fairy best welcome back to go at in for after before"
  ).split(" "),
);

/** Words that end the name a child typed after "my name is": "ava smith and I…". */
const NAME_STOP_WORDS = new Set(
  (
    "and but or i im i'm my me from at in on the a to who is was aged age years year live " +
    "go have like love so because with and also too but then"
  ).split(" "),
);

// ── Building blocks ───────────────────────────────────────────────────────────────────────

const UPPER = "A-ZÀ-ÖØ-Þ";
const LOWER = "a-zà-öø-ÿ";
/** One capitalised name word: "Ava", "O'Brien", "McDonald", "Smith-Jones". */
const CAP_WORD = `(?:Mc|Mac|O['’])?[${UPPER}][${LOWER}]+(?:[-'’][${UPPER}][${LOWER}]+)?`;
const ANY_WORD = `[${UPPER}${LOWER}][${UPPER}${LOWER}'’-]*`;

const STREET_TYPES =
  "Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Crescent|Cres|Place|Pl|Parade|Pde|" +
  "Boulevard|Blvd|Way|Close|Terrace|Tce|Highway|Hwy|Grove|Circuit|Cct|Square|Sq|Esplanade|" +
  "Rise|Mews|Parkway";
/** Street types that are not also ordinary lower-case words ("drive", "way", "close"). */
const PLAIN_STREET_TYPES =
  "street|st|rd|avenue|ave|court|ct|crescent|cres|parade|pde|boulevard|blvd|terrace|tce|" +
  "circuit|esplanade";
const AU_STATES = "VIC|NSW|QLD|SA|WA|TAS|NT|ACT|Vic|Qld|Tas";
const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|" +
  "NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WV|WI|WY|DC";
const SCHOOL_TAIL =
  "Primary(?:\\s+School)?|High(?:\\s+School)?|Secondary(?:\\s+(?:College|School))?|" +
  "College|Grammar(?:\\s+School)?|Academy|School|Kindergarten|Kinder|Elementary(?:\\s+School)?|" +
  "Middle\\s+School|Junior\\s+School|Montessori|Preschool|Early\\s+Learning(?:\\s+Centre)?";
const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const DATE =
  `\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH})(?:,?\\s+\\d{4})?|` +
  `(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|` +
  `\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?`;

const rx = (source: string, flags = "g") => new RegExp(source, flags);

const FULL_NAME_CUE = rx(
  `\\b(?:my|our|his|her|their)\\s+(?:(?:full|real|whole|last|sur)\\s*)?name\\s+is\\s+` +
    `|\\b(?:my|our)\\s+(?:mum|mom|mother|dad|father|brother|sister|teacher|friend|best\\s+friend|` +
    `nan|nana|grandma|grandpa|granny|pop|aunt|aunty|uncle|cousin)(?:'s\\s+name)?\\s+is\\s+(?:called\\s+)?`,
  "gi",
);
const INTRO_CUE = rx(`\\b(?:i'?m|i\\s+am|call\\s+me|this\\s+is|it'?s)\\s+`, "gi");
const NAME_PAIR = rx(`\\b(${CAP_WORD})\\s+(${CAP_WORD})\\b`, "g");
const TITLED_NAME = rx(`\\b(Mr|Mrs|Ms|Miss|Mx|Dr)\\.?\\s+(${CAP_WORD})\\b`, "g");

const SCHOOL_NAMED = rx(
  `\\b((?:(?:St\\.?|Saint|Mt\\.?|Mount|${CAP_WORD})\\s+){1,4})(${SCHOOL_TAIL})(?![${LOWER}])`,
  "g",
);
const SCHOOL_CUE = rx(
  `\\b(?:go(?:es)?\\s+to|went\\s+to|attend(?:s)?|i'?m\\s+at|my\\s+school\\s+is(?:\\s+called)?|school\\s+is\\s+called)\\s+` +
    `((?:[a-z'’.]+\\s+){1,4}?)(primary(?:\\s+school)?|ps|high(?:\\s+school)?|secondary(?:\\s+college)?|` +
    `college|grammar|academy|kinder(?:garten)?|elementary|school)\\b`,
  "gi",
);

const STREET_NUMBER = `(?:(?:unit|apt|apartment|flat)\\s*\\d+[A-Za-z]?\\s*[,/]?\\s*)?\\d{1,5}[A-Za-z]?(?:\\s*[/-]\\s*\\d{1,5}[A-Za-z]?)?`;
const STREET_CAPITALISED = rx(
  `\\b${STREET_NUMBER}\\s+(?:${CAP_WORD}\\s+){1,3}(?:${STREET_TYPES})\\b\\.?`,
  "g",
);
const STREET_PLAIN = rx(
  `\\b${STREET_NUMBER}\\s+(?:[a-z'’-]+\\s+){1,3}(?:${PLAIN_STREET_TYPES})\\b`,
  "gi",
);
const LIVES_ON_STREET = rx(
  `\\bi\\s+live\\s+(?:at|on)\\s+((?:${CAP_WORD}\\s+){1,3}(?:${STREET_TYPES}))\\b`,
  "gi",
);
const ADDRESS_IS = rx(`\\bmy\\s+(?:home\\s+)?address\\s+is\\s+([^.!?\\n]{3,60})`, "gi");
const AU_SUBURB_POSTCODE = rx(
  `\\b((?:(?:St\\.?|Mt\\.?|${CAP_WORD}),?\\s+){0,3})(?:${AU_STATES})\\.?,?\\s+\\d{4}\\b`,
  "g",
);
const POSTCODE_CUE = rx(`\\b(?:post\\s*code|zip(?:\\s*code)?)\\s*(?:is|:)?\\s*(\\d{4,5})\\b`, "gi");
const US_ZIP = rx(`\\b(?:${CAP_WORD},?\\s+)?(?:${US_STATES})\\s+\\d{5}(?:-\\d{4})?\\b`, "g");
const UK_POSTCODE = rx(`\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}\\b`, "g");
const LIVES_IN = rx(
  `\\b(?:i\\s+live\\s+(?:in|at|near)|we\\s+live\\s+(?:in|at|near)|my\\s+(?:suburb|town)\\s+is(?:\\s+called)?)\\s+` +
    `((?:${ANY_WORD})(?:\\s+${ANY_WORD}){0,2})`,
  "gi",
);

const PHONE_PATTERNS: ReadonlyArray<RegExp> = [
  rx(`\\+\\d{1,3}[\\s.-]?\\(?\\d{1,4}\\)?(?:[\\s.-]?\\d){5,12}`, "g"),
  rx(`\\b0[2-478](?:[\\s.-]?\\d){8}\\b`, "g"),
  rx(`\\(0[2-478]\\)\\s?\\d{4}[\\s.-]?\\d{4}\\b`, "g"),
  rx(`\\b1[38]00(?:[\\s.-]?\\d){6}\\b`, "g"),
  rx(`\\(\\d{3}\\)\\s?\\d{3}[\\s.-]?\\d{4}\\b`, "g"),
  rx(`\\b\\d{3}[.-]\\d{3}[.-]\\d{4}\\b`, "g"),
];
const PHONE_CUE = rx(
  `\\b(?:my\\s+(?:phone|mobile|mob|cell|number|home\\s+phone)(?:\\s+number)?(?:\\s+is)?|phone\\s+number(?:\\s+is)?|` +
    `mobile\\s+number(?:\\s+is)?|call\\s+me(?:\\s+on)?|ring\\s+me(?:\\s+on)?|text\\s+me(?:\\s+on)?|` +
    `ph|tel|mob)\\s*[:#]?\\s*(\\d(?:[\\s.-]?\\d){5,11})\\b`,
  "gi",
);
const EMAIL = rx(`\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}\\b`, "g");

const BIRTHDAY = rx(
  `\\b(?:birthday|b-?day|born|date\\s+of\\s+birth|dob|d\\.o\\.b\\.?)(?:\\s+is(?:\\s+on)?|\\s+was|\\s+on|\\s+in|\\s*:)?\\s*(?:the\\s+)?` +
    `(${DATE}|(?:19|20)\\d{2})\\b`,
  "gi",
);
const AGE = rx(`\\b\\d{1,2}\\s*(?:years?|yrs?)[\\s-]*old\\b`, "gi");
const LOGIN = rx(
  `\\b(?:my\\s+(?:[a-z]+\\s+)?(?:password|passcode|pass\\s*word|pin(?:\\s*(?:code|number))?|username|user\\s*name|` +
    `login|log-?in|gamer\\s*tag|screen\\s*name)(?:\\s+is|\\s*[:=]|'s|’s)|` +
    `(?:password|passcode|username|user\\s*name|pin)\\s*[:=])\\s*["'“]?([^\\s"'”]+)`,
  "gi",
);

// ── Detection ─────────────────────────────────────────────────────────────────────────────

interface Found {
  readonly category: TextPersonalCategory;
  readonly start: number;
  readonly text: string;
  readonly suggestion: string;
}

function* matches(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    yield match;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
}

/** Where `group` starts in the text: its first (or, `fromEnd`, last) place inside the match. */
function groupStart(match: RegExpExecArray, group: string, fromEnd = false): number {
  const offset = fromEnd ? match[0].lastIndexOf(group) : match[0].indexOf(group);
  return match.index + Math.max(0, offset);
}

function trimDetail(text: string): string {
  return text.replace(/[\s,.;:!?)]+$/, "");
}

/** `my name is ava smith and…` → ["ava", "smith"]; stops at the first ordinary word. */
function nameWordsAt(text: string, from: number): Array<{ word: string; start: number }> {
  const words: Array<{ word: string; start: number }> = [];
  const pattern = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*/g;
  pattern.lastIndex = from;
  let cursor = from;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    // Anything but spaces between two words ends the name ("Ava. Smith" is two sentences).
    if (/\S/.test(text.slice(cursor, match.index))) break;
    if (NAME_STOP_WORDS.has(match[0].toLowerCase())) break;
    words.push({ word: match[0], start: match.index });
    cursor = match.index + match[0].length;
    if (words.length === 3) break;
  }
  return words;
}

const spanOf = (words: ReadonlyArray<{ word: string; start: number }>) => ({
  start: words[0]!.start,
  end: words.at(-1)!.start + words.at(-1)!.word.length,
});

function fullNames(text: string): Array<Found> {
  const found: Array<Found> = [];
  const pushName = (words: ReadonlyArray<{ word: string; start: number }>) => {
    if (WELL_KNOWN_NAMES.has(words.map((entry) => entry.word.toLowerCase()).join(" "))) return;
    const { start, end } = spanOf(words);
    found.push({
      category: "full-name",
      start,
      text: text.slice(start, end),
      suggestion: words[0]!.word,
    });
  };
  for (const match of matches(FULL_NAME_CUE, text)) {
    const words = nameWordsAt(text, match.index + match[0].length);
    if (words.length >= 2) pushName(words);
  }
  for (const match of matches(INTRO_CUE, text)) {
    const words = nameWordsAt(text, match.index + match[0].length).slice(0, 2);
    if (words.length < 2) continue;
    const [first, last] = [words[0]!.word, words[1]!.word];
    if (!GIVEN_NAMES.has(first.toLowerCase())) continue;
    const surnameLike =
      SURNAMES.has(last.toLowerCase().replace(/['’]/g, "")) ||
      (/^[A-ZÀ-ÖØ-Þ]/.test(last) && !NOT_SURNAMES.has(last.toLowerCase()));
    if (surnameLike) pushName(words);
  }
  for (const match of matches(NAME_PAIR, text)) {
    const [first, last] = [match[1]!, match[2]!];
    if (!GIVEN_NAMES.has(first.toLowerCase())) continue;
    if (NOT_SURNAMES.has(last.toLowerCase())) continue;
    pushName([
      { word: first, start: match.index },
      { word: last, start: match.index + match[0].length - last.length },
    ]);
    // "Ava Smith Jones": let the next pair start at the surname, not skip it.
    NAME_PAIR.lastIndex = match.index + first.length + 1;
  }
  for (const match of matches(TITLED_NAME, text)) {
    const surname = match[2]!;
    if (NOT_SURNAMES.has(surname.toLowerCase())) continue;
    found.push({
      category: "full-name",
      start: match.index,
      text: match[0],
      suggestion: `${match[1]} ${surname[0]}.`,
    });
  }
  return found;
}

function schools(text: string): Array<Found> {
  const found: Array<Found> = [];
  const push = (start: number, detail: string) =>
    found.push({ category: "school", start, text: trimDetail(detail), suggestion: "school" });
  const meaningful = (words: string) =>
    words
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .filter((word, index, all) => {
        // Generic words only count as generic at the front ("Little River Primary" is real).
        const leading = all.slice(0, index).every((w) => GENERIC_SCHOOL_WORDS.has(w.toLowerCase()));
        return !(leading && GENERIC_SCHOOL_WORDS.has(word.toLowerCase()));
      });
  for (const match of matches(SCHOOL_NAMED, text)) {
    const kept = meaningful(match[1]!);
    if (kept.length === 0) continue;
    const start = groupStart(match, kept[0]!);
    push(start, text.slice(start, match.index + match[0].length));
  }
  for (const match of matches(SCHOOL_CUE, text)) {
    const kept = meaningful(match[1]!);
    if (kept.length === 0) continue;
    const start = groupStart(match, kept[0]!);
    push(start, text.slice(start, match.index + match[0].length));
  }
  return found;
}

function addresses(text: string): Array<Found> {
  const found: Array<Found> = [];
  const push = (start: number, detail: string, suggestion: string) =>
    found.push({ category: "address", start, text: trimDetail(detail), suggestion });
  for (const pattern of [STREET_CAPITALISED, STREET_PLAIN]) {
    for (const match of matches(pattern, text)) {
      // "5 trees on the street" is a drawing, not an address.
      const words = match[0].split(/\s+/).slice(1, -1);
      if (words.some((word) => NAME_STOP_WORDS.has(word.toLowerCase()))) continue;
      push(match.index, match[0], "my street");
    }
  }
  for (const match of matches(LIVES_ON_STREET, text)) {
    push(groupStart(match, match[1]!, true), match[1]!, "my street");
  }
  for (const match of matches(ADDRESS_IS, text)) {
    push(groupStart(match, match[1]!, true), match[1]!, "a secret");
  }
  for (const match of matches(AU_SUBURB_POSTCODE, text)) {
    const kept = match[1]!.trim();
    const start = kept.length > 0 ? groupStart(match, kept) : match.index;
    push(start, text.slice(start, match.index + match[0].length), "my town");
  }
  for (const match of matches(POSTCODE_CUE, text)) {
    push(groupStart(match, match[1]!, true), match[1]!, "a secret");
  }
  for (const pattern of [US_ZIP, UK_POSTCODE]) {
    for (const match of matches(pattern, text)) push(match.index, match[0], "my town");
  }
  for (const match of matches(LIVES_IN, text)) {
    const words = nameWordsAt(text, match.index + match[0].length - match[1]!.length);
    if (words.length === 0) continue;
    const place = words.map((entry) => entry.word).join(" ");
    if (NOT_HOMES.has(place.toLowerCase()) || NOT_HOMES.has(words[0]!.word.toLowerCase())) {
      continue;
    }
    const { start, end } = spanOf(words);
    push(start, text.slice(start, end), "my town");
  }
  return found;
}

function digitCount(text: string): number {
  return text.replace(/\D/g, "").length;
}

function phones(text: string): Array<Found> {
  const found: Array<Found> = [];
  const push = (start: number, detail: string) =>
    found.push({ category: "phone", start, text: detail, suggestion: "my phone number" });
  for (const pattern of PHONE_PATTERNS) {
    for (const match of matches(pattern, text)) {
      const digits = digitCount(match[0]);
      if (digits >= 8 && digits <= 15) push(match.index, match[0].trim());
    }
  }
  for (const match of matches(PHONE_CUE, text)) {
    const digits = digitCount(match[1]!);
    if (digits >= 6) push(groupStart(match, match[1]!, true), match[1]!);
  }
  return found;
}

function emails(text: string): Array<Found> {
  return [...matches(EMAIL, text)].map((match) => ({
    category: "email" as const,
    start: match.index,
    text: match[0],
    suggestion: "my email",
  }));
}

function birthdays(text: string, hasFullName: boolean): Array<Found> {
  const found: Array<Found> = [];
  for (const match of matches(BIRTHDAY, text)) {
    const date = match[1]!;
    found.push({
      category: "birthday",
      start: groupStart(match, date, true),
      text: date,
      suggestion: /^(19|20)\d{2}$/.test(date) ? "a secret year" : "a secret day",
    });
  }
  // An age is nothing on its own; beside a full name it helps find one child.
  if (hasFullName) {
    for (const match of matches(AGE, text)) {
      found.push({ category: "birthday", start: match.index, text: match[0], suggestion: "a kid" });
    }
  }
  return found;
}

function logins(text: string): Array<Found> {
  return [...matches(LOGIN, text)].flatMap((match) => {
    const value = trimDetail(match[1]!);
    if (value.length === 0) return [];
    return [
      {
        category: "login" as const,
        start: groupStart(match, value, true),
        text: value,
        suggestion: "a secret",
      },
    ];
  });
}

/**
 * Every likely personal detail in `text`, in reading order, never overlapping (the longer of
 * two overlapping catches wins). Empty for ordinary requests.
 */
export function findPersonalDetails(text: string): Array<PersonalDetail> {
  if (text.trim().length === 0) return [];
  const names = fullNames(text);
  const all: Array<Found> = [
    ...emails(text),
    ...logins(text),
    ...phones(text),
    ...addresses(text),
    ...schools(text),
    ...names,
    ...birthdays(text, names.length > 0),
  ];
  const ordered = all
    .filter((found) => found.text.length > 0)
    .sort((a, b) => a.start - b.start || b.text.length - a.text.length);
  const kept: Array<PersonalDetail> = [];
  for (const found of ordered) {
    const end = found.start + found.text.length;
    const previous = kept.at(-1);
    if (previous !== undefined && found.start < previous.end) {
      if (end - found.start <= previous.end - previous.start) continue;
      kept.pop();
    }
    kept.push({ ...found, end });
  }
  return kept;
}

/** The text with each detail swapped for its stand-in (or `replace`'s answer). */
export function replacePersonalDetails(
  text: string,
  details: ReadonlyArray<PersonalDetail>,
  replace: (detail: PersonalDetail) => string = (detail) => detail.suggestion,
): string {
  let out = text;
  for (const detail of [...details].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, detail.start) + replace(detail) + out.slice(detail.end);
  }
  return out;
}

/** The one-tap rewrite: "my name is Ava and I go to school". */
export function rewriteWithNicknames(text: string): string {
  return replacePersonalDetails(text, findPersonalDetails(text));
}

/** The categories found, in the order of `PERSONAL_CATEGORIES`, each once. */
export function personalCategories(
  details: ReadonlyArray<Pick<PersonalDetail, "category">>,
): Array<PersonalCategory> {
  const present = new Set(details.map((detail) => detail.category));
  return PERSONAL_CATEGORIES.map((info) => info.id).filter((id) => present.has(id));
}

/** "a full name and a school's name" */
export function describePersonalCategories(categories: ReadonlyArray<PersonalCategory>): string {
  const parts = categories.map((id) => NOUN.get(id) ?? id);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** What the engine puts where a detail was: "[hidden by SKYCOT: a full name]". */
export function hiddenPlaceholder(category: PersonalCategory): string {
  return `[hidden by SKYCOT: ${NOUN.get(category) ?? "a private detail"}]`;
}

export interface Redaction {
  readonly text: string;
  /** Only the kinds of detail, never the values: safe to log. */
  readonly categories: ReadonlyArray<PersonalCategory>;
}

/** The engine's defence in depth: the same catches, hidden rather than nicknamed. */
export function redactPersonalDetails(text: string): Redaction {
  const details = findPersonalDetails(text);
  if (details.length === 0) return { text, categories: [] };
  return {
    text: replacePersonalDetails(text, details, (detail) => hiddenPlaceholder(detail.category)),
    categories: personalCategories(details),
  };
}
