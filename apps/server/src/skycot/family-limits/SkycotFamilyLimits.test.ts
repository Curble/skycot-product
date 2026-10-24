import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyLimits from "./SkycotFamilyLimits.ts";

const CODE = "482913";
const SESSION = "session-kid";
const MELBOURNE = "Australia/Melbourne";
const at = (iso: string) => TestClock.setTime(Date.parse(iso));

const withLimits = <A, E, R>(
  use: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
    readonly activityPath: string;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-limits-" });
    const activityPath = path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME);
    return yield* Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      return yield* use({ family, limits, activityPath });
    }).pipe(
      Effect.provide(
        SkycotFamilyLimits.layerAt(activityPath).pipe(
          Layer.provideMerge(SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME))),
        ),
      ),
    );
  }).pipe(Effect.scoped);

it.layer(NodeServices.layer)("SkycotFamilyLimits", (it) => {
  it.effect("counts active minutes from heartbeats, once a minute, and gives the heads-up", () =>
    withLimits(({ family, limits }) =>
      Effect.gen(function* () {
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* family.updateChild({
          childId: status.children[0]!.id,
          patch: { limits: { dailyMinutes: 10 } },
        });
        yield* at("2026-10-22T16:00:00+11:00");
        for (let beat = 0; beat < 12; beat += 1) {
          // Twice a minute, as the client sends them.
          yield* limits.heartbeat({ sessionId: SESSION, active: true });
          yield* TestClock.adjust("30 seconds");
        }
        const idle = yield* limits.heartbeat({ sessionId: SESSION, active: false });
        assert.equal(idle.limits?.usedMinutes, 6);
        assert.equal(idle.limits?.minutesLeft, 4);
        assert.isTrue(idle.limits?.headsUp);
        for (let beat = 0; beat < 8; beat += 1) {
          yield* limits.heartbeat({ sessionId: SESSION, active: true });
          yield* TestClock.adjust("30 seconds");
        }
        const done = yield* limits.forSession({ sessionId: SESSION });
        assert.isTrue(done.limits?.asleep);
        assert.equal(done.limits?.reason, "time");
        assert.include(done.sentence ?? "", "today's 10 minutes");
      }),
    ),
  );

  it.effect(
    "keeps yesterday's minutes for the recap after midnight, and what needed a grown-up",
    () =>
      withLimits(({ family, limits }) =>
        Effect.gen(function* () {
          const status = yield* family.enable({
            code: CODE,
            childName: "Ava",
            timeZone: MELBOURNE,
          });
          const ava = status.children[0]!.id;
          yield* at("2026-10-21T16:00:00+11:00");
          yield* limits.admitTurn({ sessionId: SESSION });
          yield* TestClock.adjust("1 minute");
          yield* limits.heartbeat({ sessionId: SESSION, active: true });
          yield* limits.recordEvent({ sessionId: SESSION, kind: "shield", categories: ["school"] });
          yield* at("2026-10-22T09:00:00+11:00");
          yield* limits.heartbeat({ sessionId: SESSION, active: true });
          const snapshot = yield* limits.snapshot;
          assert.deepEqual(snapshot?.activity.history[ava], [
            { date: "2026-10-21", minutes: 2, turns: 1 },
          ]);
          assert.equal(snapshot?.activity.days[ava]?.date, "2026-10-22");
          assert.deepEqual(
            snapshot?.activity.events.map((event) => [event.childId, event.kind, event.categories]),
            [[ava, "shield", ["school"]]],
          );
        }),
      ),
  );

  it.effect("a heartbeat that is not active counts nothing", () =>
    withLimits(({ family, limits }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* at("2026-10-22T16:00:00+11:00");
        for (let beat = 0; beat < 6; beat += 1) {
          yield* limits.heartbeat({ sessionId: SESSION, active: false });
          yield* TestClock.adjust("1 minute");
        }
        assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.usedMinutes, 0);
      }),
    ),
  );

  it.effect("a profile turned off and on again starts with an empty day", () =>
    withLimits(({ family, limits }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* at("2026-10-22T16:00:00+11:00");
        yield* limits.admitTurn({ sessionId: SESSION });
        assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.turns, 1);
        yield* family.disable({ code: CODE });
        yield* TestClock.adjust("1 minute");
        yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.turns, 0);
      }),
    ),
  );

  it.effect("an unreadable activity file reads as an empty day, never as asleep", () =>
    withLimits(({ family, limits, activityPath }) =>
      Effect.gen(function* () {
        yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        yield* (yield* FileSystem.FileSystem).writeFileString(activityPath, "{ not json");
        yield* at("2026-10-22T16:00:00+11:00");
        yield* limits.admitTurn({ sessionId: SESSION });
        assert.equal((yield* limits.forSession({ sessionId: SESSION })).limits?.turns, 1);
      }),
    ),
  );

  it.effect("is inert while the profile is off", () =>
    withLimits(({ limits }) =>
      Effect.gen(function* () {
        yield* limits.admitTurn({ sessionId: SESSION });
        assert.deepEqual(yield* limits.heartbeat({ sessionId: SESSION, active: true }), {
          childId: null,
          needsChoice: false,
          device: "shared",
          limits: null,
          sentence: null,
        });
      }),
    ),
  );
  it.effect("says whose conversation a step is and whether it may run by itself", () =>
    withLimits(({ family, limits }) =>
      Effect.gen(function* () {
        const rule = (threadId: string) => limits.stepRuleFor({ threadId });
        assert.deepEqual(yield* rule("t-1"), {
          type: "ask",
          reason: "profile-off",
          childId: null,
        });
        const status = yield* family.enable({ code: CODE, childName: "Ava", timeZone: MELBOURNE });
        const ava = status.children[0]!.id;
        yield* at("2026-10-22T16:00:00+11:00");
        // One child: an unrecorded conversation is theirs. The setting starts off.
        assert.isUndefined(status.children[0]!.askEachStep);
        assert.deepEqual(yield* rule("t-1"), { type: "auto", childId: ava });
        // The parent's switch brings the card for every step back, and is kept in the file.
        const asked = yield* family.updateChild({ childId: ava, patch: { askEachStep: true } });
        assert.isTrue(asked.children[0]!.askEachStep);
        assert.deepEqual(yield* rule("t-1"), {
          type: "ask",
          reason: "ask-each-step",
          childId: ava,
        });
        // Other changes leave it alone; a non-boolean is ignored.
        yield* family.updateChild({
          childId: ava,
          patch: { largerText: false, askEachStep: "yes" },
        });
        assert.isTrue((yield* family.status).children[0]!.askEachStep);
        yield* family.updateChild({ childId: ava, patch: { askEachStep: false } });
        assert.deepEqual(yield* rule("t-1"), { type: "auto", childId: ava });
        // Asleep: the step keeps its card (the gate refuses it until morning).
        yield* family.updateChild({
          childId: ava,
          patch: { limits: { bedtime: { start: "19:30", end: "07:00" } } },
        });
        yield* at("2026-10-22T21:00:00+11:00");
        assert.deepEqual(yield* rule("t-1"), { type: "ask", reason: "asleep", childId: ava });
        yield* at("2026-10-23T09:00:00+11:00");
        // Siblings: a conversation is judged by the child who started it; nobody's keeps cards.
        const added = yield* family.addChild({ name: "Leo", askEachStep: true });
        yield* limits.choose({ sessionId: SESSION, childId: added.childId, grownUp: false });
        yield* limits.recordStart({ sessionId: SESSION, threadId: "t-leo" });
        assert.deepEqual(yield* rule("t-leo"), {
          type: "ask",
          reason: "ask-each-step",
          childId: added.childId,
        });
        yield* limits.choose({ sessionId: SESSION, childId: ava, grownUp: false });
        yield* limits.recordStart({ sessionId: SESSION, threadId: "t-ava" });
        assert.deepEqual(yield* rule("t-ava"), { type: "auto", childId: ava });
        assert.deepEqual(yield* rule("t-unknown"), {
          type: "ask",
          reason: "no-child",
          childId: null,
        });
      }),
    ),
  );
});
