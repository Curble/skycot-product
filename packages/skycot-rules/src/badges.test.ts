import { describe, expect, it } from "vite-plus/test";

import {
  BADGE_IDS,
  applyBadgeEvent,
  badgeProgress,
  bookView,
  emptyBook,
  markSeen,
  noteProjectChild,
  observeBedtime,
  parseBadgeEvent,
  parseBadgeFile,
  parseBookView,
  type BadgeBook,
  type BadgeEvent,
} from "./badges.ts";

const NO_TOPICS = { game: false, animal: false, story: false };

const message = (
  overrides: Partial<Extract<BadgeEvent, { type: "message" }>> = {},
): BadgeEvent => ({
  type: "message",
  messageId: overrides.messageId ?? "m1",
  threadId: "t1",
  followUp: false,
  starter: null,
  picture: false,
  kindWords: false,
  askedHow: false,
  afterCheck: false,
  lookChange: false,
  ...overrides,
});

const made = (
  threadId: string,
  overrides: Partial<Extract<BadgeEvent, { type: "made" }>> = {},
): BadgeEvent => ({
  type: "made",
  threadId,
  title: `Thing ${threadId}`,
  starter: null,
  topics: NO_TOPICS,
  ...overrides,
});

function run(events: ReadonlyArray<BadgeEvent>, start: BadgeBook = emptyBook()) {
  let book = start;
  const earned: string[] = [];
  events.forEach((event, index) => {
    const outcome = applyBadgeEvent(book, event, 1_000 + index);
    book = outcome.book;
    earned.push(...outcome.earned);
  });
  return { book, earned };
}

describe("badge rules", () => {
  it("has sixteen stickers, none about time spent or coming back", () => {
    expect(BADGE_IDS).toHaveLength(16);
    expect(BADGE_IDS.some((id) => /streak|daily|owl|late/.test(id))).toBe(false);
  });

  it("a finished conversation is the first creation, with its title for the certificate", () => {
    const { book, earned } = run([made("t1", { title: "Catch the stars" })]);
    expect(earned).toEqual(["first-creation"]);
    expect(book.earned["first-creation"]).toMatchObject({
      threadId: "t1",
      title: "Catch the stars",
      seen: false,
    });
  });

  it("the same conversation finishing again is not another creation", () => {
    const { book, earned } = run([made("t1"), made("t1"), made("t1")]);
    expect(book.creations).toBe(1);
    expect(earned).toEqual(["first-creation"]);
  });

  it("counts five and ten different creations, and remembers the tenth's title", () => {
    const events = Array.from({ length: 10 }, (_, index) => made(`t${index + 1}`));
    const { book, earned } = run(events);
    expect(earned).toEqual(["first-creation", "five", "ten"]);
    expect(book.earned.ten?.title).toBe("Thing t10");
    expect(book.earned.five?.threadId).toBe("t5");
  });

  it("reads the game, animal and story stickers from the starter card or the words", () => {
    expect(run([made("a", { starter: "game" })]).earned).toContain("first-game");
    expect(run([made("a", { topics: { ...NO_TOPICS, game: true } })]).earned).toContain(
      "first-game",
    );
    expect(run([made("a", { starter: "pet" })]).earned).toContain("animal-friend");
    expect(run([made("a", { topics: { ...NO_TOPICS, animal: true } })]).earned).toContain(
      "animal-friend",
    );
    expect(run([made("a", { starter: "comic" })]).earned).toContain("storyteller");
    expect(run([made("a", { starter: "quiz" })]).earned).toEqual(["first-creation"]);
  });

  it("a picture has to go with the message for Drew it", () => {
    expect(run([message({ starter: "draw" })]).earned).toEqual([]);
    expect(run([message({ starter: "draw", picture: true })]).earned).toEqual(["drew-it"]);
  });

  it("asking how three times, counted once per message", () => {
    const { book, earned } = run([
      message({ messageId: "a", askedHow: true }),
      message({ messageId: "a", askedHow: true }),
      message({ messageId: "b", askedHow: true }),
    ]);
    expect(book.bigQuestions).toBe(2);
    expect(earned).toEqual([]);
    expect(badgeProgress(book, "big-question")).toEqual({ have: 2, need: 3 });
    const third = applyBadgeEvent(book, message({ messageId: "c", askedHow: true }), 5);
    expect(third.earned).toEqual(["big-question"]);
  });

  it("Explorer needs three different starter cards", () => {
    const { earned, book } = run([
      message({ messageId: "1", starter: "game" }),
      message({ messageId: "2", starter: "game" }),
      message({ messageId: "3", starter: "pet" }),
    ]);
    expect(earned).toEqual([]);
    expect(badgeProgress(book, "explorer")).toEqual({ have: 2, need: 3 });
    expect(applyBadgeEvent(book, message({ messageId: "4", starter: "comic" }), 9).earned).toEqual([
      "explorer",
    ]);
  });

  it("Mo's helper and Designer are for follow-ups, not a first message", () => {
    expect(run([message({ afterCheck: true, lookChange: true })]).earned).toEqual([]);
    expect(run([message({ followUp: true, afterCheck: true, lookChange: true })]).earned).toEqual([
      "mo-check",
      "designer",
    ]);
  });

  it("kind words, Undo, voice and together are one moment each", () => {
    const { earned, book } = run([
      message({ kindWords: true }),
      { type: "undo", threadId: "t1" },
      { type: "undo", threadId: "t2" },
      { type: "voice" },
      { type: "together", threadId: null },
    ]);
    expect(earned).toEqual(["kind-words", "undo", "voice", "together"]);
    expect(book.earned.undo?.threadId).toBe("t1");
  });

  it("several stickers at once come back in catalogue order", () => {
    const outcome = applyBadgeEvent(
      emptyBook(),
      made("t", { starter: "game", topics: { ...NO_TOPICS, story: true } }),
      1,
    );
    expect(outcome.earned).toEqual(["first-creation", "first-game", "storyteller"]);
  });

  it("a sticker is never taken away and seen is remembered", () => {
    const { book } = run([made("t1")]);
    const seen = markSeen(book, ["first-creation", "ten"]);
    expect(seen.earned["first-creation"]?.seen).toBe(true);
    expect(markSeen(seen, ["first-creation"])).toBe(seen);
    const again = applyBadgeEvent(seen, made("t2"), 99);
    expect(again.book.earned["first-creation"]).toEqual(seen.earned["first-creation"]);
  });
});

describe("Good night", () => {
  const bedtime = { inside: true, startsAt: 10_000, endsAt: 50_000 };
  const evening = (now: number, asleep: boolean, woke = false) => ({
    now,
    bedtime,
    asleepForBedtime: asleep,
    grownUpWokeIt: woke,
  });
  const morning = { now: 60_000, bedtime: null, asleepForBedtime: false, grownUpWokeIt: false };

  it("is said in the morning when SKYCOT was let sleep at bedtime", () => {
    const night = observeBedtime(emptyBook(), evening(12_000, true));
    expect(night.earned).toEqual([]);
    expect(night.book.night).toEqual({ startsAt: 10_000, endsAt: 50_000, spoiled: false });
    const later = observeBedtime(night.book, evening(20_000, true));
    expect(later.earned).toEqual([]);
    const awake = observeBedtime(later.book, morning);
    expect(awake.earned).toEqual(["good-night"]);
    expect(awake.book.night).toBeNull();
  });

  it("asking a grown-up for more time that night means no sticker, and no fuss", () => {
    const night = observeBedtime(emptyBook(), evening(12_000, true));
    const extended = observeBedtime(night.book, evening(14_000, false));
    expect(extended.book.night?.spoiled).toBe(true);
    const next = observeBedtime(extended.book, morning);
    expect(next.earned).toEqual([]);
    expect(next.book.night).toBeNull();
  });

  it("a grown-up's more time logged before we looked also spoils the night", () => {
    const night = observeBedtime(emptyBook(), evening(12_000, true, true));
    expect(observeBedtime(night.book, morning).earned).toEqual([]);
  });

  it("nothing happens without a bedtime, or once it is earned", () => {
    expect(observeBedtime(emptyBook(), morning).book.night).toBeNull();
    const earned = observeBedtime(observeBedtime(emptyBook(), evening(12_000, true)).book, morning);
    const after = observeBedtime(earned.book, evening(70_000, true));
    expect(after.earned).toEqual([]);
    expect(after.book.night).toBeNull();
  });
});

describe("Built together", () => {
  it("two children on one project makes it shared", () => {
    const first = noteProjectChild({}, "p1", "ava");
    expect(first.together).toEqual([]);
    const same = noteProjectChild(first.projects, "p1", "ava");
    expect(same.together).toEqual([]);
    const second = noteProjectChild(same.projects, "p1", "leo");
    expect(second.together).toEqual(["ava", "leo"]);
  });
});

describe("the badge file (migration-safe)", () => {
  it("round-trips", () => {
    const { book } = run([made("t1"), message({ askedHow: true })]);
    const file = { version: 1 as const, books: { ava: book }, projects: { p: ["ava"] } };
    expect(parseBadgeFile(JSON.stringify(file))).toEqual(file);
  });

  it("fills fields an older engine never wrote and skips stickers it does not know", () => {
    const raw = JSON.stringify({
      version: 1,
      books: {
        ava: {
          earned: {
            "first-creation": { at: 5, title: "Hi" },
            "sticker-from-the-future": { at: 6 },
            undo: { nope: true },
          },
        },
        leo: "garbage",
      },
    });
    const file = parseBadgeFile(raw)!;
    expect(file.projects).toEqual({});
    expect(file.books.ava).toEqual({
      ...emptyBook(),
      earned: { "first-creation": { at: 5, threadId: null, title: "Hi", seen: true } },
    });
    expect(file.books.leo).toEqual(emptyBook());
  });

  it("is not a badge file when it is broken or from another version", () => {
    expect(parseBadgeFile("{ nope")).toBeNull();
    expect(parseBadgeFile(JSON.stringify({ version: 2, books: {} }))).toBeNull();
    expect(parseBadgeFile("[]")).toBeNull();
  });

  it("the book view survives the wire", () => {
    const { book } = run([made("t1"), message({ starter: "game" })]);
    const view = bookView("ava", book);
    expect(view.badges).toHaveLength(16);
    expect(parseBookView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(view.badges.find((badge) => badge.id === "explorer")?.progress).toEqual({
      have: 1,
      need: 3,
    });
    expect(view.badges.find((badge) => badge.id === "first-creation")?.progress).toBeNull();
  });
});

describe("events off the wire", () => {
  it("keeps the facts and drops anything else", () => {
    expect(
      parseBadgeEvent({
        type: "message",
        messageId: "m",
        threadId: "t",
        picture: true,
        text: "my address is…",
        kindWords: "yes",
      }),
    ).toEqual(message({ messageId: "m", threadId: "t", picture: true }));
  });

  it("trims a creation's title and refuses what a client cannot claim", () => {
    const parsed = parseBadgeEvent({ type: "made", threadId: "t", title: `  ${"x".repeat(100)} ` });
    expect(parsed?.type === "made" ? parsed.title?.length : null).toBe(80);
    expect(parseBadgeEvent({ type: "together", threadId: "t" })).toBeNull();
    expect(parseBadgeEvent({ type: "message", threadId: "t" })).toBeNull();
    expect(parseBadgeEvent("voice")).toBeNull();
    expect(parseBadgeEvent({ type: "voice" })).toEqual({ type: "voice" });
  });
});
