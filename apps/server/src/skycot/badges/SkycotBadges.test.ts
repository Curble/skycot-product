import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { BadgeEvent, BookView } from "@t3tools/skycot-rules/badges";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotBadges from "./SkycotBadges.ts";

const CODE = "482913";
const MELBOURNE = "Australia/Melbourne";
const at = (iso: string) => TestClock.setTime(Date.parse(iso));

const message = (messageId: string, overrides: Partial<BadgeEvent> = {}): BadgeEvent =>
  ({
    type: "message",
    messageId,
    threadId: "t1",
    followUp: false,
    starter: null,
    picture: false,
    kindWords: false,
    askedHow: false,
    afterCheck: false,
    lookChange: false,
    ...overrides,
  }) as BadgeEvent;

const made = (threadId: string): BadgeEvent => ({
  type: "made",
  threadId,
  title: "My game",
  starter: "game",
  topics: { game: true, animal: false, story: false },
});

const earnedIds = (book: BookView | null) =>
  (book?.badges ?? []).filter((badge) => badge.earned !== null).map((badge) => badge.id);

const withBadges = <A, E, R>(
  use: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
    readonly badges: SkycotBadges.SkycotBadges["Service"];
    readonly badgesPath: string;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-badges-" });
    const badgesPath = path.join(dir, SkycotBadges.BADGES_FILE_NAME);
    return yield* Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      const badges = yield* SkycotBadges.SkycotBadges;
      return yield* use({ family, limits, badges, badgesPath });
    }).pipe(
      Effect.provide(
        SkycotBadges.layerAt(badgesPath).pipe(
          Layer.provideMerge(
            SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
          ),
          Layer.provideMerge(SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME))),
        ),
      ),
    );
  }).pipe(Effect.scoped);

it.layer(NodeServices.layer)("SkycotBadges", (it) => {
  it.effect("keeps one book while Family is off, and it survives a new engine", () =>
    withBadges(({ badges }) =>
      Effect.gen(function* () {
        yield* at("2026-10-22T16:00:00+11:00");
        const first = yield* badges.record({
          sessionId: "s1",
          event: made("t1"),
          projectId: "p1",
        });
        assert.deepEqual(first.earned, ["first-creation", "first-game"]);
        assert.isNull(first.book?.childId);
        // Another device (a cleared browser is a new session too) reads the same book.
        const elsewhere = yield* badges.forSession({ sessionId: "s2" });
        assert.deepEqual(earnedIds(elsewhere.book), ["first-creation", "first-game"]);
        const seen = yield* badges.seen({ sessionId: "s2", ids: ["first-creation"] });
        assert.isTrue(
          seen.book?.badges.find((badge) => badge.id === "first-creation")?.earned?.seen,
        );
      }),
    ),
  );

  it.effect("each child has their own book; a creation is the starter's", () =>
    withBadges(({ family, limits, badges }) =>
      Effect.gen(function* () {
        yield* at("2026-10-22T16:00:00+11:00");
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        const ava = status.children[0]!.id;
        const { childId: leo } = yield* family.addChild({ name: "Leo" });
        yield* limits.choose({ sessionId: "ava-tablet", childId: ava, grownUp: false });
        yield* limits.choose({ sessionId: "leo-laptop", childId: leo, grownUp: false });
        yield* limits.recordStart({ sessionId: "ava-tablet", threadId: "t-ava" });
        // Leo's laptop saw Ava's conversation finish: still Ava's creation.
        const seenByLeo = yield* badges.record({
          sessionId: "leo-laptop",
          event: made("t-ava"),
          projectId: null,
        });
        assert.deepEqual(seenByLeo.earned, []);
        assert.deepEqual(earnedIds(seenByLeo.book), []);
        const avaBook = yield* badges.forSession({ sessionId: "ava-tablet" });
        assert.equal(avaBook.book?.childId, ava);
        assert.deepEqual(earnedIds(avaBook.book), ["first-creation", "first-game"]);
      }),
    ),
  );

  it.effect("no book until someone is chosen on a device with more than one child", () =>
    withBadges(({ family, badges }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* family.addChild({ name: "Leo" });
        const answer = yield* badges.record({
          sessionId: "nobody",
          event: { type: "voice" },
          projectId: null,
        });
        assert.isNull(answer.book);
      }),
    ),
  );

  it.effect("two children messaging on one project are Built together, both of them", () =>
    withBadges(({ family, limits, badges }) =>
      Effect.gen(function* () {
        yield* at("2026-10-22T16:00:00+11:00");
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        const ava = status.children[0]!.id;
        const { childId: leo } = yield* family.addChild({ name: "Leo" });
        yield* limits.choose({ sessionId: "mac", childId: ava, grownUp: false });
        yield* badges.record({ sessionId: "mac", event: message("m1"), projectId: "p1" });
        yield* limits.choose({ sessionId: "mac", childId: leo, grownUp: false });
        const leoAnswer = yield* badges.record({
          sessionId: "mac",
          event: message("m2"),
          projectId: "p1",
        });
        assert.deepEqual(leoAnswer.earned, ["together"]);
        yield* limits.choose({ sessionId: "mac", childId: ava, grownUp: false });
        const avaBook = (yield* badges.forSession({ sessionId: "mac" })).book;
        const together = avaBook?.badges.find((badge) => badge.id === "together")?.earned;
        assert.isFalse(together?.seen);
      }),
    ),
  );

  it.effect("Good night, the morning after SKYCOT was let sleep at bedtime", () =>
    withBadges(({ family, badges }) =>
      Effect.gen(function* () {
        yield* at("2026-10-22T16:00:00+11:00");
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* family.updateChild({
          childId: status.children[0]!.id,
          patch: { limits: { bedtime: { start: "19:30", end: "07:00" } } },
        });
        yield* at("2026-10-22T20:00:00+11:00");
        const evening = yield* badges.forSession({ sessionId: "mac" });
        assert.deepEqual(evening.earned, []);
        yield* at("2026-10-23T07:30:00+11:00");
        const morning = yield* badges.forSession({ sessionId: "mac" });
        assert.deepEqual(morning.earned, ["good-night"]);
      }),
    ),
  );

  it.effect("no Good night when a grown-up gave more time at bedtime", () =>
    withBadges(({ family, limits, badges }) =>
      Effect.gen(function* () {
        yield* at("2026-10-22T16:00:00+11:00");
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        const ava = status.children[0]!.id;
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { bedtime: { start: "19:30", end: "07:00" } } },
        });
        yield* at("2026-10-22T20:00:00+11:00");
        yield* badges.forSession({ sessionId: "mac" });
        yield* limits.moreTime({
          sessionId: "mac",
          childId: ava,
          code: CODE,
          more: { type: "extra", minutes: 15 },
        });
        yield* badges.forSession({ sessionId: "mac" });
        yield* at("2026-10-23T07:30:00+11:00");
        const morning = yield* badges.forSession({ sessionId: "mac" });
        assert.deepEqual(morning.earned, []);
      }),
    ),
  );

  it.effect("an unreadable file is moved aside, not overwritten", () =>
    withBadges(({ badges, badgesPath }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(badgesPath, "{ half a file");
        yield* badges.record({ sessionId: "s", event: { type: "voice" }, projectId: null });
        const names = yield* fs.readDirectory(path.dirname(badgesPath));
        assert.isTrue(names.some((name) => name.includes(".unreadable-")));
        const kept = yield* fs.readFileString(
          path.join(
            path.dirname(badgesPath),
            names.find((name) => name.includes(".unreadable-"))!,
          ),
        );
        assert.equal(kept, "{ half a file");
        const book = (yield* badges.forSession({ sessionId: "s" })).book;
        assert.deepEqual(earnedIds(book), ["voice"]);
      }),
    ),
  );

  it.effect("a removed child's book goes at the next write; the recap lists every book", () =>
    withBadges(({ family, limits, badges }) =>
      Effect.gen(function* () {
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        const ava = status.children[0]!.id;
        const { childId: leo } = yield* family.addChild({ name: "Leo" });
        yield* limits.choose({ sessionId: "a", childId: ava, grownUp: false });
        yield* limits.choose({ sessionId: "l", childId: leo, grownUp: false });
        yield* badges.record({ sessionId: "a", event: { type: "voice" }, projectId: null });
        yield* badges.record({ sessionId: "l", event: { type: "voice" }, projectId: null });
        assert.deepEqual(
          (yield* badges.all).map((book) => book.childId),
          [ava, leo],
        );
        yield* family.removeChild({ childId: leo });
        yield* badges.record({
          sessionId: "a",
          event: { type: "undo", threadId: null },
          projectId: null,
        });
        assert.deepEqual(
          (yield* badges.all).map((book) => book.childId),
          [ava],
        );
      }),
    ),
  );
});
