// SKYCOT's stickers, kept by the engine: one sticker book per child in
// `<T3 home>/userdata/skycot-family-badges.json`, beside the Family profile and its activity
// file. The rules are the shared pure ones (`@t3tools/skycot-rules/badges`); this service
// decides whose book an event belongs to, reads bedtime for "Good night", notices two children
// on one project for "Built together", and writes the file.
//
// Why the engine and not the browser: a child's stickers must survive a cleared browser, a
// second device and a re-paired tablet, and the grown-ups' recap reads them from here. The
// client only reports what it saw (a message it sent, a creation SKYCOT finished, an Undo,
// words heard by the microphone), as facts with no message text.
//
// Whose book: the child chosen on the reporting device (SkycotFamilyLimits), except a creation,
// which belongs to the child who started that conversation. With the Family profile off there
// is one book (`solo`) for whoever uses this Mac. A book for a child the parent removed is
// dropped at the next write. A file that cannot be read is moved aside, never overwritten.

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  SOLO_BOOK,
  applyBadgeEvent,
  bookView,
  emptyBadgeFile,
  emptyBook,
  markSeen,
  noteProjectChild,
  observeBedtime,
  parseBadgeFile,
  type BadgeBook,
  type BadgeEvent,
  type BadgeFile,
  type BadgeId,
  type BookView,
} from "@t3tools/skycot-rules/badges";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";

export const BADGES_FILE_NAME = "skycot-family-badges.json";

export interface BadgeAnswer {
  /** Null while a child has to be chosen on this device first. */
  readonly book: BookView | null;
  /** Stickers this call earned for this book. */
  readonly earned: ReadonlyArray<BadgeId>;
}

export class SkycotBadges extends Context.Service<
  SkycotBadges,
  {
    /** This device's book (bedtime is read on the way, for "Good night"). */
    readonly forSession: (input: { readonly sessionId: string }) => Effect.Effect<BadgeAnswer>;
    /** Something the device saw; `projectId` lets the engine notice siblings sharing a project. */
    readonly record: (input: {
      readonly sessionId: string;
      readonly event: BadgeEvent;
      readonly projectId: string | null;
    }) => Effect.Effect<BadgeAnswer>;
    /** The child saw these arrive (the celebration, or the sticker book). */
    readonly seen: (input: {
      readonly sessionId: string;
      readonly ids: ReadonlyArray<BadgeId>;
    }) => Effect.Effect<BadgeAnswer>;
    /** Every book, for the grown-ups' recap: Family children first, then the `solo` book. */
    readonly all: Effect.Effect<ReadonlyArray<BookView>>;
  }
>()("t3/skycot/badges/SkycotBadges") {}

type Profile = SkycotFamily.FamilyStatus;

const makeAt = Effect.fn("SkycotBadges.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const family = yield* SkycotFamily.SkycotFamily;
  const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make<{ readonly stamp: string; readonly file: BadgeFile | null }>({
    stamp: "",
    file: null,
  });
  const now = Clock.currentTimeMillis;

  const load = Effect.gen(function* () {
    const info = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (info === null) return emptyBadgeFile();
    const mtime = info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0;
    const stamp = `${mtime}:${info.size}`;
    const cached = yield* Ref.get(cache);
    if (cached.stamp === stamp && cached.file !== null) return cached.file;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => null));
    if (raw === null) return emptyBadgeFile();
    const file = parseBadgeFile(raw);
    if (file === null) {
      // Keep what was there for a grown-up (or a newer SKYCOT) to look at; start a new book.
      const aside = `${filePath}.unreadable-${yield* now}`;
      yield* fs.rename(filePath, aside).pipe(Effect.ignore);
      yield* Effect.logWarning("The sticker file could not be read; it was moved aside.", {
        aside,
      });
      return emptyBadgeFile();
    }
    yield* Ref.set(cache, { stamp, file });
    return file;
  });

  const save = Effect.fn("SkycotBadges.save")(
    function* (file: BadgeFile, profile: Profile | null) {
      const keep =
        profile !== null && profile.enabled
          ? new Set([SOLO_BOOK, ...profile.children.map((child) => child.id)])
          : null;
      const books =
        keep === null
          ? file.books
          : Object.fromEntries(Object.entries(file.books).filter(([key]) => keep.has(key)));
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      // Plain data from the pure rules module (its own lenient reader parses it back).
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      yield* fs.writeFileString(temp, `${JSON.stringify({ ...file, books }, null, 2)}\n`, {
        mode: 0o600,
      });
      yield* fs.rename(temp, filePath);
      yield* Ref.set(cache, { stamp: "", file: null });
    },
    Effect.catchCause((cause) => Effect.logWarning("Could not save the sticker file.", { cause })),
  );

  const profileStatus = family.status.pipe(Effect.orElseSucceed(() => null));

  /** The book this device writes to: its chosen child, `solo` with Family off, else none yet. */
  const keyFor = Effect.fnUntraced(function* (profile: Profile | null, sessionId: string) {
    if (profile === null || !profile.enabled) return SOLO_BOOK;
    return (yield* limits.forSession({ sessionId })).childId;
  });

  const viewOf = (profile: Profile | null, key: string, file: BadgeFile) =>
    bookView(profile !== null && profile.enabled ? key : null, file.books[key] ?? emptyBook());

  /** Tonight's bedtime for this child, read for "Good night" (Family children only). */
  const withBedtime = Effect.fnUntraced(function* (
    profile: Profile | null,
    key: string,
    book: BadgeBook,
    at: number,
  ) {
    if (profile === null || !profile.enabled || key === SOLO_BOOK) {
      return { book, earned: [] as ReadonlyArray<BadgeId> };
    }
    if (book.earned["good-night"] !== undefined && book.night === null) {
      return { book, earned: [] as ReadonlyArray<BadgeId> };
    }
    const today = yield* limits.today;
    const child = today.children.find((entry) => entry.childId === key);
    const bedtime = child?.limits.bedtime ?? null;
    return observeBedtime(book, {
      now: at,
      bedtime,
      asleepForBedtime: child?.limits.asleep === true && child.limits.reason === "bedtime",
      grownUpWokeIt:
        bedtime !== null &&
        (child?.moreTime ?? []).some(
          (entry) => entry.at >= bedtime.startsAt && entry.at <= bedtime.endsAt,
        ),
    });
  });

  const forSession: SkycotBadges["Service"]["forSession"] = Effect.fn("SkycotBadges.forSession")(
    function* (input) {
      const profile = yield* profileStatus;
      const key = yield* keyFor(profile, input.sessionId);
      if (key === null) return { book: null, earned: [] };
      const file = yield* load;
      const before = file.books[key] ?? emptyBook();
      const outcome = yield* withBedtime(profile, key, before, yield* now);
      if (outcome.book === before) return { book: viewOf(profile, key, file), earned: [] };
      const next: BadgeFile = { ...file, books: { ...file.books, [key]: outcome.book } };
      yield* save(next, profile);
      return { book: viewOf(profile, key, next), earned: outcome.earned };
    },
    lock.withPermits(1),
  );

  const record: SkycotBadges["Service"]["record"] = Effect.fn("SkycotBadges.record")(function* (
    input,
  ) {
    const profile = yield* profileStatus;
    const sessionKey = yield* keyFor(profile, input.sessionId);
    if (sessionKey === null) return { book: null, earned: [] };
    const familyOn = profile !== null && profile.enabled;
    // A creation is the child's who started the conversation, whoever's device saw it finish.
    let key = sessionKey;
    if (familyOn && input.event.type === "made") {
      const owner = (yield* limits.today).threads[input.event.threadId];
      if (owner !== undefined && profile.children.some((child) => child.id === owner)) {
        key = owner;
      }
    }
    const at = yield* now;
    const file = yield* load;
    let books: Record<string, BadgeBook> = { ...file.books };
    const applied = applyBadgeEvent(books[key] ?? emptyBook(), input.event, at);
    books[key] = applied.book;
    const earned = new Map<string, ReadonlyArray<BadgeId>>([[key, applied.earned]]);
    let projects = file.projects;
    // Siblings only exist in Family; a message (or creation) puts its child on the project.
    if (familyOn && input.projectId !== null && key !== SOLO_BOOK) {
      const noted = noteProjectChild(projects, input.projectId, key);
      projects = noted.projects;
      const threadId = "threadId" in input.event ? input.event.threadId : null;
      for (const child of noted.together) {
        const together = applyBadgeEvent(
          books[child] ?? emptyBook(),
          {
            type: "together",
            threadId,
          },
          at,
        );
        books[child] = together.book;
        earned.set(child, [...(earned.get(child) ?? []), ...together.earned]);
      }
    }
    const bedtime = yield* withBedtime(profile, key, books[key]!, at);
    books = { ...books, [key]: bedtime.book };
    const next: BadgeFile = { ...file, books, projects };
    const changed =
      Object.keys(books).some((child) => books[child] !== file.books[child]) ||
      projects !== file.projects;
    if (changed) yield* save(next, profile);
    const mine = [...(earned.get(key) ?? []), ...bedtime.earned];
    if (mine.length > 0) yield* Effect.logInfo("skycot-badges.earned", { key, ids: mine });
    // The answer is about this device's book (a creation can land in a sibling's).
    return {
      book: viewOf(profile, sessionKey, next),
      earned: key === sessionKey ? mine : (earned.get(sessionKey) ?? []),
    };
  }, lock.withPermits(1));

  const seen: SkycotBadges["Service"]["seen"] = Effect.fn("SkycotBadges.seen")(function* (input) {
    const profile = yield* profileStatus;
    const key = yield* keyFor(profile, input.sessionId);
    if (key === null) return { book: null, earned: [] };
    const file = yield* load;
    const before = file.books[key];
    if (before === undefined) return { book: viewOf(profile, key, file), earned: [] };
    const after = markSeen(before, input.ids);
    if (after === before) return { book: viewOf(profile, key, file), earned: [] };
    const next: BadgeFile = { ...file, books: { ...file.books, [key]: after } };
    yield* save(next, profile);
    return { book: viewOf(profile, key, next), earned: [] };
  }, lock.withPermits(1));

  const all: SkycotBadges["Service"]["all"] = Effect.gen(function* () {
    const profile = yield* profileStatus;
    const file = yield* load;
    const familyOn = profile !== null && profile.enabled;
    const children = familyOn
      ? profile.children.map((child) => bookView(child.id, file.books[child.id] ?? emptyBook()))
      : [];
    const solo = file.books[SOLO_BOOK];
    return solo === undefined ? children : [...children, bookView(null, solo)];
  }).pipe(Effect.withSpan("SkycotBadges.all"));

  return SkycotBadges.of({ forSession, record, seen, all });
});

/** For tests and tools: a sticker file at an explicit path. */
export const layerAt = (filePath: string) => Layer.effect(SkycotBadges, makeAt(filePath));

/** The engine's sticker file, beside the Family profile in `<T3 home>/userdata/`. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, BADGES_FILE_NAME));
  }),
);
