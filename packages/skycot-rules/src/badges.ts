// SKYCOT's stickers: which real moments earn which sticker, for one child. Pure and shared:
// the engine applies these rules and keeps the result (`skycot-family-badges.json`, beside the
// Family activity file), and the plain client reads the same ids, counts and hints to draw
// the sticker book. Nothing here rewards time spent, asks a child to come back, or takes a
// sticker away: a sticker is a thing that happened, kept for good.
//
// Every event is a fact the client saw (a message it sent, a conversation SKYCOT finished, an
// Undo, words heard by the microphone) or a fact the engine read itself (bedtime, a second
// child on the same project). Text never reaches this file: the client turns a message into
// a handful of booleans first (apps/nondev/src/features/badges/facts.ts).

export const BADGE_IDS = [
  "first-creation",
  "first-game",
  "animal-friend",
  "drew-it",
  "big-question",
  "undo",
  "mo-check",
  "voice",
  "together",
  "kind-words",
  "good-night",
  "five",
  "ten",
  "explorer",
  "storyteller",
  "designer",
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

const BADGE_SET: ReadonlySet<string> = new Set(BADGE_IDS);

export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === "string" && BADGE_SET.has(value);
}

/** How many of a thing a counted sticker needs. */
export const NEEDS = {
  bigQuestion: 3,
  five: 5,
  ten: 10,
  explorer: 3,
} as const;

/** The book key when the Family profile is off: one book for whoever uses this Mac. */
export const SOLO_BOOK = "solo";

/** Bounded lists, so a busy year never grows the file without end. */
const KEEP_IDS = 300;
const KEEP_STARTERS = 40;
const KEEP_PROJECTS = 200;

export interface EarnedBadge {
  /** Epoch ms. */
  readonly at: number;
  /** The conversation it came from, when there was one. */
  readonly threadId: string | null;
  /** The creation's title at the time (first creation, tenth creation), for the certificate. */
  readonly title: string | null;
  /** False until the child has seen the sticker arrive (celebration or the book). */
  readonly seen: boolean;
}

/** A bedtime SKYCOT went to sleep for, waiting for the morning to say "Good night". */
export interface PendingNight {
  /** When that bedtime began (epoch ms); one night, one key. */
  readonly startsAt: number;
  readonly endsAt: number;
  /** A grown-up woke SKYCOT during it: no sticker for this night. */
  readonly spoiled: boolean;
}

export interface BadgeBook {
  readonly earned: Partial<Record<BadgeId, EarnedBadge>>;
  /** Different conversations SKYCOT finished with something made. */
  readonly creations: number;
  readonly madeThreads: ReadonlyArray<string>;
  /** Messages already counted (the client may report one twice). */
  readonly countedMessages: ReadonlyArray<string>;
  readonly bigQuestions: number;
  /** Different starter cards used. */
  readonly starters: ReadonlyArray<string>;
  readonly night: PendingNight | null;
}

export interface BadgeFile {
  readonly version: 1;
  /** Child id (or `solo`) → book. */
  readonly books: Readonly<Record<string, BadgeBook>>;
  /** Project id → the children who sent a message in it, for "Built together". */
  readonly projects: Readonly<Record<string, ReadonlyArray<string>>>;
}

export const emptyBook = (): BadgeBook => ({
  earned: {},
  creations: 0,
  madeThreads: [],
  countedMessages: [],
  bigQuestions: 0,
  starters: [],
  night: null,
});

export const emptyBadgeFile = (): BadgeFile => ({ version: 1, books: {}, projects: {} });

/** What a creation was about, read from its first message. */
export interface CreationTopics {
  readonly game: boolean;
  readonly animal: boolean;
  readonly story: boolean;
}

export type BadgeEvent =
  /** A message this child sent (the client's device sent it). */
  | {
      readonly type: "message";
      readonly messageId: string;
      readonly threadId: string;
      /** Not the conversation's first message. */
      readonly followUp: boolean;
      /** The starter card it came from, if any. */
      readonly starter: string | null;
      readonly picture: boolean;
      readonly kindWords: boolean;
      readonly askedHow: boolean;
      /** Sent after Mo double-checked something in this conversation. */
      readonly afterCheck: boolean;
      /** Asks to change colours, fonts or the look. */
      readonly lookChange: boolean;
    }
  /** SKYCOT finished a turn that changed files: the conversation is a creation. */
  | {
      readonly type: "made";
      readonly threadId: string;
      readonly title: string | null;
      readonly starter: string | null;
      readonly topics: CreationTopics;
    }
  | { readonly type: "undo"; readonly threadId: string | null }
  | { readonly type: "voice" }
  /** The engine saw two children on one project. */
  | { readonly type: "together"; readonly threadId: string | null };

const GAME_STARTERS: ReadonlySet<string> = new Set(["game"]);
const ANIMAL_STARTERS: ReadonlySet<string> = new Set(["pet"]);
const STORY_STARTERS: ReadonlySet<string> = new Set(["comic"]);

function keepLast<A>(list: ReadonlyArray<A>, item: A, keep: number): ReadonlyArray<A> {
  return [...list, item].slice(-keep);
}

interface Draft {
  book: BadgeBook;
  readonly earned: BadgeId[];
}

function earn(
  draft: Draft,
  id: BadgeId,
  at: number,
  extra: { readonly threadId?: string | null; readonly title?: string | null } = {},
): void {
  if (draft.book.earned[id] !== undefined) return;
  draft.book = {
    ...draft.book,
    earned: {
      ...draft.book.earned,
      [id]: { at, threadId: extra.threadId ?? null, title: extra.title ?? null, seen: false },
    },
  };
  draft.earned.push(id);
}

export interface BadgeOutcome {
  readonly book: BadgeBook;
  /** Stickers this event earned, in catalogue order. */
  readonly earned: ReadonlyArray<BadgeId>;
}

function ordered(ids: ReadonlyArray<BadgeId>): ReadonlyArray<BadgeId> {
  return BADGE_IDS.filter((id) => ids.includes(id));
}

/** One event into one child's book. Earning is forever; a repeated event changes nothing. */
export function applyBadgeEvent(book: BadgeBook, event: BadgeEvent, at: number): BadgeOutcome {
  const draft: Draft = { book, earned: [] };
  switch (event.type) {
    case "message": {
      if (book.countedMessages.includes(event.messageId)) return { book, earned: [] };
      draft.book = {
        ...draft.book,
        countedMessages: keepLast(book.countedMessages, event.messageId, KEEP_IDS),
      };
      const thread = { threadId: event.threadId };
      if (event.starter !== null && !draft.book.starters.includes(event.starter)) {
        draft.book = {
          ...draft.book,
          starters: keepLast(draft.book.starters, event.starter, KEEP_STARTERS),
        };
      }
      if (draft.book.starters.length >= NEEDS.explorer) earn(draft, "explorer", at, thread);
      // The "Draw it" card alone is not enough: a picture has to go with the message.
      if (event.picture) earn(draft, "drew-it", at, thread);
      if (event.askedHow) {
        draft.book = { ...draft.book, bigQuestions: draft.book.bigQuestions + 1 };
        if (draft.book.bigQuestions >= NEEDS.bigQuestion) earn(draft, "big-question", at, thread);
      }
      if (event.kindWords) earn(draft, "kind-words", at, thread);
      if (event.afterCheck && event.followUp) earn(draft, "mo-check", at, thread);
      if (event.lookChange && event.followUp) earn(draft, "designer", at, thread);
      break;
    }
    case "made": {
      if (book.madeThreads.includes(event.threadId)) return { book, earned: [] };
      const creations = book.creations + 1;
      draft.book = {
        ...draft.book,
        creations,
        madeThreads: keepLast(book.madeThreads, event.threadId, KEEP_IDS),
      };
      const extra = { threadId: event.threadId, title: event.title };
      earn(draft, "first-creation", at, extra);
      const starter = event.starter;
      if (event.topics.game || (starter !== null && GAME_STARTERS.has(starter))) {
        earn(draft, "first-game", at, extra);
      }
      if (event.topics.animal || (starter !== null && ANIMAL_STARTERS.has(starter))) {
        earn(draft, "animal-friend", at, extra);
      }
      if (event.topics.story || (starter !== null && STORY_STARTERS.has(starter))) {
        earn(draft, "storyteller", at, extra);
      }
      if (creations >= NEEDS.five) earn(draft, "five", at, extra);
      if (creations >= NEEDS.ten) earn(draft, "ten", at, extra);
      break;
    }
    case "undo":
      earn(draft, "undo", at, { threadId: event.threadId });
      break;
    case "voice":
      earn(draft, "voice", at);
      break;
    case "together":
      earn(draft, "together", at, { threadId: event.threadId });
      break;
  }
  return { book: draft.book, earned: ordered(draft.earned) };
}

/** What the engine read about tonight for this child (SkycotFamilyLimits). */
export interface BedtimeReading {
  readonly now: number;
  /** Tonight's bedtime, or null when this child has none. */
  readonly bedtime: {
    readonly inside: boolean;
    readonly startsAt: number;
    readonly endsAt: number;
  } | null;
  /** SKYCOT is asleep because of bedtime. */
  readonly asleepForBedtime: boolean;
  /** A grown-up gave more time (or ended bedtime) during tonight's bedtime. */
  readonly grownUpWokeIt: boolean;
}

/**
 * "Good night": SKYCOT went to sleep at bedtime and the child let it sleep, with no "more
 * time" asked of a grown-up that night. Judged in the morning (after the bedtime ends), so
 * asking later in the evening still counts as asking. Missing a night costs nothing: no
 * streak, no reminder, the next bedtime is just another chance.
 */
export function observeBedtime(book: BadgeBook, reading: BedtimeReading): BadgeOutcome {
  if (book.earned["good-night"] !== undefined) {
    return book.night === null
      ? { book, earned: [] }
      : { book: { ...book, night: null }, earned: [] };
  }
  const draft: Draft = { book, earned: [] };
  let night = book.night;
  const bedtime = reading.bedtime;
  // A pending night that has ended: say good night (or quietly drop a spoiled one).
  if (night !== null && reading.now >= night.endsAt) {
    if (!night.spoiled) earn(draft, "good-night", night.endsAt);
    night = null;
  }
  if (draft.earned.length === 0 && bedtime !== null && bedtime.inside) {
    const sameNight = night !== null && night.startsAt === bedtime.startsAt;
    if (reading.asleepForBedtime && !sameNight) {
      night = {
        startsAt: bedtime.startsAt,
        endsAt: bedtime.endsAt,
        spoiled: reading.grownUpWokeIt,
      };
    } else if (sameNight && (reading.grownUpWokeIt || !reading.asleepForBedtime)) {
      // Awake inside bedtime means a grown-up opened it up tonight.
      night = { ...night!, spoiled: true };
    }
  }
  draft.book = { ...draft.book, night };
  return { book: draft.book, earned: draft.earned };
}

/** The children seen on a project after this one, and whether that makes it shared. */
export function noteProjectChild(
  projects: BadgeFile["projects"],
  projectId: string,
  childId: string,
): { readonly projects: BadgeFile["projects"]; readonly together: ReadonlyArray<string> } {
  const before = projects[projectId] ?? [];
  const children = before.includes(childId) ? before : [...before, childId];
  let next: Record<string, ReadonlyArray<string>> = { ...projects, [projectId]: children };
  const keys = Object.keys(next);
  if (keys.length > KEEP_PROJECTS) {
    next = Object.fromEntries(keys.slice(-KEEP_PROJECTS).map((key) => [key, next[key]!]));
  }
  return { projects: next, together: children.length >= 2 ? children : [] };
}

/** The child has seen these arrive. */
export function markSeen(book: BadgeBook, ids: ReadonlyArray<BadgeId>): BadgeBook {
  let changed = false;
  const earned: Partial<Record<BadgeId, EarnedBadge>> = { ...book.earned };
  for (const id of ids) {
    const badge = earned[id];
    if (badge !== undefined && !badge.seen) {
      earned[id] = { ...badge, seen: true };
      changed = true;
    }
  }
  return changed ? { ...book, earned } : book;
}

/** "2 of 3" for the counted stickers still to find; null for the one-moment stickers. */
export function badgeProgress(
  book: BadgeBook,
  id: BadgeId,
): { readonly have: number; readonly need: number } | null {
  const of = (have: number, need: number) => ({ have: Math.min(have, need), need });
  switch (id) {
    case "big-question":
      return of(book.bigQuestions, NEEDS.bigQuestion);
    case "five":
      return of(book.creations, NEEDS.five);
    case "ten":
      return of(book.creations, NEEDS.ten);
    case "explorer":
      return of(book.starters.length, NEEDS.explorer);
    default:
      return null;
  }
}

// Reading the file. Lenient on purpose: a field an older engine never wrote takes its default,
// an unknown sticker id (from a newer engine) is skipped, and a broken book is an empty book.
// Never throws; the engine never overwrites a file it could not read (it moves it aside).

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asStrings = (value: unknown, keep: number): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(-keep)
    : [];

function parseEarned(value: unknown): EarnedBadge | null {
  const record = asRecord(value);
  if (record === null || typeof record["at"] !== "number") return null;
  return {
    at: record["at"],
    threadId: typeof record["threadId"] === "string" ? record["threadId"] : null,
    title: typeof record["title"] === "string" ? record["title"] : null,
    seen: record["seen"] !== false,
  };
}

function parseNight(value: unknown): PendingNight | null {
  const record = asRecord(value);
  if (record === null) return null;
  const startsAt = record["startsAt"];
  const endsAt = record["endsAt"];
  if (typeof startsAt !== "number" || typeof endsAt !== "number") return null;
  return { startsAt, endsAt, spoiled: record["spoiled"] === true };
}

export function parseBook(value: unknown): BadgeBook {
  const record = asRecord(value);
  if (record === null) return emptyBook();
  const earned: Partial<Record<BadgeId, EarnedBadge>> = {};
  for (const [id, entry] of Object.entries(asRecord(record["earned"]) ?? {})) {
    const parsed = isBadgeId(id) ? parseEarned(entry) : null;
    if (parsed !== null) earned[id as BadgeId] = parsed;
  }
  return {
    earned,
    creations: Math.max(0, Math.floor(asNumber(record["creations"], 0))),
    madeThreads: asStrings(record["madeThreads"], KEEP_IDS),
    countedMessages: asStrings(record["countedMessages"], KEEP_IDS),
    bigQuestions: Math.max(0, Math.floor(asNumber(record["bigQuestions"], 0))),
    starters: asStrings(record["starters"], KEEP_STARTERS),
    night: parseNight(record["night"]),
  };
}

/** The file as JSON text, or null when it is not a badge file at all. */
export function parseBadgeFile(raw: string): BadgeFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null || record["version"] !== 1) return null;
  const books: Record<string, BadgeBook> = {};
  for (const [key, book] of Object.entries(asRecord(record["books"]) ?? {})) {
    books[key] = parseBook(book);
  }
  const projects: Record<string, ReadonlyArray<string>> = {};
  for (const [key, children] of Object.entries(asRecord(record["projects"]) ?? {})) {
    projects[key] = asStrings(children, 20);
  }
  return { version: 1, books, projects };
}

// The view both the client and the grown-ups' recap read.

export interface BadgeView {
  readonly id: BadgeId;
  readonly earned: EarnedBadge | null;
  readonly progress: { readonly have: number; readonly need: number } | null;
}

export interface BookView {
  /** The child this book belongs to; null for the one book used while Family is off. */
  readonly childId: string | null;
  readonly badges: ReadonlyArray<BadgeView>;
  readonly creations: number;
}

export function bookView(childId: string | null, book: BadgeBook): BookView {
  return {
    childId,
    creations: book.creations,
    badges: BADGE_IDS.map((id) => ({
      id,
      earned: book.earned[id] ?? null,
      progress: book.earned[id] === undefined ? badgeProgress(book, id) : null,
    })),
  };
}

export function parseBookView(value: unknown): BookView | null {
  const record = asRecord(value);
  if (record === null || !Array.isArray(record["badges"])) return null;
  const childId = typeof record["childId"] === "string" ? record["childId"] : null;
  const badges: BadgeView[] = [];
  for (const entry of record["badges"]) {
    const badge = asRecord(entry);
    if (badge === null || !isBadgeId(badge["id"])) continue;
    const progress = asRecord(badge["progress"]);
    badges.push({
      id: badge["id"],
      earned: parseEarned(badge["earned"]),
      progress:
        progress !== null &&
        typeof progress["have"] === "number" &&
        typeof progress["need"] === "number"
          ? { have: progress["have"], need: progress["need"] }
          : null,
    });
  }
  return {
    childId,
    badges: BADGE_IDS.flatMap((id) => badges.find((badge) => badge.id === id) ?? []),
    creations: asNumber(record["creations"], 0),
  };
}

/** An event off the wire (the client's POST), or null when it is not one. Text never passes. */
export function parseBadgeEvent(value: unknown): BadgeEvent | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = (key: string) => {
    const raw = record[key];
    return typeof raw === "string" && raw.length > 0 && raw.length <= 200 ? raw : null;
  };
  const flag = (key: string) => record[key] === true;
  const starter = id("starter");
  switch (record["type"]) {
    case "message": {
      const messageId = id("messageId");
      const threadId = id("threadId");
      if (messageId === null || threadId === null) return null;
      return {
        type: "message",
        messageId,
        threadId,
        followUp: flag("followUp"),
        starter,
        picture: flag("picture"),
        kindWords: flag("kindWords"),
        askedHow: flag("askedHow"),
        afterCheck: flag("afterCheck"),
        lookChange: flag("lookChange"),
      };
    }
    case "made": {
      const threadId = id("threadId");
      if (threadId === null) return null;
      const topics = asRecord(record["topics"]) ?? {};
      const title = typeof record["title"] === "string" ? record["title"].trim().slice(0, 80) : "";
      return {
        type: "made",
        threadId,
        title: title.length > 0 ? title : null,
        starter,
        topics: {
          game: topics["game"] === true,
          animal: topics["animal"] === true,
          story: topics["story"] === true,
        },
      };
    }
    case "undo":
      return { type: "undo", threadId: id("threadId") };
    case "voice":
      return { type: "voice" };
    default:
      // "together" is the engine's own conclusion; a client cannot claim it.
      return null;
  }
}
