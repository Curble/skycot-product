import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamily from "./SkycotFamily.ts";

// nondev-seam: skycot-page-internet-ask-storage-test

const CODE = "482913";
const SESSION = "session-parent";

/** A fresh profile file in a temp dir, and the service over it. */
const withFamily = <A, E, R>(
  use: (family: SkycotFamily.SkycotFamily["Service"], filePath: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-" });
    const filePath = path.join(dir, SkycotFamily.FAMILY_FILE_NAME);
    const family = yield* Effect.provide(SkycotFamily.SkycotFamily, SkycotFamily.layerAt(filePath));
    return yield* use(family, filePath);
  }).pipe(Effect.scoped);

const failureOf = <A>(effect: Effect.Effect<A, SkycotFamily.FamilyError>) => Effect.flip(effect);

it.layer(NodeServices.layer)("SkycotFamily", (it) => {
  describe("turning on and off", () => {
    it.effect("starts off, turns on with a name and never exposes the hash", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const off = yield* family.status;
          assert.deepEqual(
            { ...off, timeZone: "engine" },
            {
              enabled: false,
              childName: null,
              createdAt: null,
              attemptsLeft: SkycotFamily.MAX_ATTEMPTS,
              lockedForMs: 0,
              children: [],
              timeZone: "engine",
              allowedAssistants: [],
              trustedAddOns: false,
              grownUps: [],
              devices: [],
              pageInternet: [],
            },
          );
          const status = yield* family.enable({ code: CODE, childName: "  Ava  " });
          // "Trusted add-ons download by themselves" starts on.
          assert.isTrue(status.trustedAddOns);
          assert.isTrue(status.enabled);
          assert.equal(status.childName, "Ava");
          assert.notProperty(status, "codeHash");
          const raw = yield* (yield* FileSystem.FileSystem).readFileString(filePath);
          assert.notInclude(raw, CODE);
          assert.isTrue(yield* family.isEnabled);
        }),
      ),
    );

    it.effect("trusted add-ons: on by default, the parent code changes it either way", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          assert.isFalse(yield* family.trustedAddOnsOn);
          yield* family.enable({ code: CODE, childName: "Ava" });
          assert.isTrue(yield* family.trustedAddOnsOn);
          assert.equal(
            (yield* failureOf(family.setTrustedAddOns({ code: "000000", on: false }))).reason,
            "wrong-code",
          );
          assert.isTrue(yield* family.trustedAddOnsOn);
          const off = yield* family.setTrustedAddOns({ code: CODE, on: false });
          assert.isFalse(off.trustedAddOns);
          assert.isFalse(yield* family.trustedAddOnsOn);
          assert.isTrue((yield* family.setTrustedAddOns({ code: CODE, on: true })).trustedAddOns);
        }),
      ),
    );

    it.effect("a page uses internet sites only after the parent code, and can lose them", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const page = path.join(yield* fs.realPath(path.dirname(filePath)), "dog.html");
          yield* fs.writeFileString(page, "<h1>Dogs</h1>");
          // Off: no policy at all, as before the profile.
          assert.isNull(yield* family.pageInternetSites(page));
          yield* family.enable({ code: CODE, childName: "Ava" });
          assert.deepStrictEqual(yield* family.pageInternetSites(page), []);
          const wrong = yield* failureOf(
            family.allowPageInternet({ code: "000000", page, sites: ["dog.ceo"] }),
          );
          assert.equal(wrong.reason, "wrong-code");
          assert.deepStrictEqual(yield* family.pageInternetSites(page), []);
          // A page that is not there is no request.
          const missing = yield* failureOf(
            family.allowPageInternet({ code: CODE, page: `${page}x.html`, sites: ["dog.ceo"] }),
          );
          assert.equal(missing.reason, "invalid-request");
          const status = yield* family.allowPageInternet({
            code: CODE,
            page,
            sites: ["images.dog.ceo", "localhost"],
          });
          assert.deepStrictEqual(
            status.pageInternet.map((entry) => entry.sites),
            [["dog.ceo"]],
          );
          assert.deepStrictEqual(yield* family.pageInternetSites(page), ["dog.ceo"]);
          assert.deepStrictEqual(
            yield* family.pageInternetSites(path.join(path.dirname(page), "other.html")),
            [],
          );
          // Taking it back needs no code: it only makes the profile stricter.
          const stopped = yield* family.stopPageInternet({ page });
          assert.lengthOf(stopped.pageInternet, 0);
          assert.deepStrictEqual(yield* family.pageInternetSites(page), []);
        }),
      ),
    );

    it.effect("a page ask is exact, idempotent, bounded by expiry, and grants atomically", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const page = path.join(yield* fs.realPath(path.dirname(filePath)), "dog.html");
          yield* fs.writeFileString(page, "<h1>Dogs</h1>");
          yield* family.enable({ code: CODE, childName: "Ava" });
          const input = {
            threadId: "thread-1",
            childId: "child-1",
            page,
            sites: ["images.dog.ceo", "dog.ceo", "dog.ceo"],
          };
          const first = yield* family.askPageInternet(input);
          const retry = yield* family.askPageInternet(input);
          assert.equal(retry.id, first.id);
          assert.deepEqual(first.sites, ["dog.ceo"]);
          const changed = yield* family.askPageInternet({ ...input, sites: ["cats.example.com"] });
          assert.notEqual(changed.id, first.id);
          assert.deepEqual(
            (yield* family.pendingPageInternetAsks).map((ask) => ask.id),
            [changed.id],
          );
          const settled = yield* family.settlePageInternetAsk({
            id: changed.id,
            decision: "allow",
          });
          assert.equal(settled.status, "allowed");
          assert.deepEqual(yield* family.pageInternetSites(page), ["example.com"]);
          assert.equal(
            (yield* failureOf(family.settlePageInternetAsk({ id: changed.id, decision: "allow" })))
              .reason,
            "invalid-request",
          );
        }),
      ),
    );

    it.effect("page asks expire and cannot be answered", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const page = path.join(yield* fs.realPath(path.dirname(filePath)), "dog.html");
          yield* fs.writeFileString(page, "<h1>Dogs</h1>");
          yield* family.enable({ code: CODE, childName: "Ava" });
          const ask = yield* family.askPageInternet({
            threadId: "thread-1",
            childId: "child-1",
            page,
            sites: ["dog.ceo"],
          });
          yield* TestClock.adjust("30 minutes");
          assert.equal((yield* family.pendingPageInternetAsks)[0]?.id, ask.id);
          assert.equal(
            (yield* failureOf(family.settlePageInternetAsk({ id: ask.id, decision: "allow" })))
              .reason,
            "invalid-request",
          );
          assert.deepEqual(yield* family.pageInternetSites(page), []);
        }),
      ),
    );

    it.effect("a parent code settles covered page asks in the same save", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.realPath(path.dirname(filePath));
          const page = path.join(directory, "dog.html");
          const otherPage = path.join(directory, "cat.html");
          yield* fs.writeFileString(page, "<h1>Dogs</h1>");
          yield* fs.writeFileString(otherPage, "<h1>Cats</h1>");
          yield* family.enable({ code: CODE, childName: "Ava" });
          const covered = yield* family.askPageInternet({
            threadId: "thread-1",
            childId: "child-1",
            page,
            sites: ["dog.ceo"],
          });
          const partial = yield* family.askPageInternet({
            threadId: "thread-2",
            childId: "child-1",
            page,
            sites: ["dog.ceo", "cats.example.com"],
          });
          const otherPageAsk = yield* family.askPageInternet({
            threadId: "thread-3",
            childId: "child-1",
            page: otherPage,
            sites: ["dog.ceo"],
          });

          assert.equal(
            (yield* failureOf(
              family.allowPageInternet({ code: "000000", page, sites: ["dog.ceo"] }),
            )).reason,
            "wrong-code",
          );
          assert.deepEqual(
            (yield* family.pendingPageInternetAsks).map((ask) => ask.id),
            [covered.id, partial.id, otherPageAsk.id],
          );

          yield* family.allowPageInternet({ code: CODE, page, sites: ["dog.ceo"] });
          assert.deepEqual(
            (yield* family.pendingPageInternetAsks).map((ask) => ask.id),
            [partial.id, otherPageAsk.id],
          );
        }),
      ),
    );

    it.effect("refuses a code that is not 4 to 6 digits, and a second enable", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          assert.equal(
            (yield* failureOf(family.enable({ code: "12", childName: null }))).reason,
            "invalid-code",
          );
          yield* family.enable({ code: CODE, childName: null });
          assert.equal(
            (yield* failureOf(family.enable({ code: "1111", childName: null }))).reason,
            "already-enabled",
          );
        }),
      ),
    );

    it.effect("turns off only with the right code, and forgets everything", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          assert.equal((yield* failureOf(family.disable({ code: "000000" }))).reason, "wrong-code");
          const off = yield* family.disable({ code: CODE });
          assert.isFalse(off.enabled);
          assert.isFalse(yield* (yield* FileSystem.FileSystem).exists(filePath));
          assert.isFalse(yield* family.isEnabled);
        }),
      ),
    );

    it.effect("changes the code: the old one stops working and old tokens die", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          const before = yield* family.verify({
            code: CODE,
            purpose: "advanced",
            sessionId: SESSION,
          });
          yield* family.changeCode({ oldCode: CODE, newCode: "7351" });
          assert.isFalse(yield* family.tokenAllows(before.token, "advanced"));
          assert.isFalse(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
          assert.equal(
            (yield* failureOf(
              family.verify({ code: CODE, purpose: "publish", sessionId: SESSION }),
            )).reason,
            "wrong-code",
          );
          yield* family.verify({ code: "7351", purpose: "publish", sessionId: SESSION });
        }),
      ),
    );
  });

  describe("wrong tries", () => {
    it.effect("five wrong tries lock every prompt for five minutes, then the count restarts", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          for (const left of [4, 3, 2, 1]) {
            const error = yield* failureOf(
              family.verify({ code: "111111", purpose: "publish", sessionId: SESSION }),
            );
            assert.equal(error.reason, "wrong-code");
            assert.equal(error.attemptsLeft, left);
          }
          const fifth = yield* failureOf(
            family.verify({ code: "111111", purpose: "publish", sessionId: SESSION }),
          );
          assert.equal(fifth.reason, "locked");
          assert.equal(fifth.remainingMs, SkycotFamily.LOCKOUT_MS);
          // Even the right code is not compared while locked.
          const locked = yield* failureOf(
            family.verify({ code: CODE, purpose: "publish", sessionId: SESSION }),
          );
          assert.equal(locked.reason, "locked");
          assert.equal((yield* family.status).attemptsLeft, 0);

          yield* TestClock.adjust("5 minutes");
          assert.equal((yield* family.status).lockedForMs, 0);
          assert.equal((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS);
          yield* family.verify({ code: CODE, purpose: "publish", sessionId: SESSION });
        }),
      ),
    );

    it("a clock moved back cannot stretch the wait past one lockout", () => {
      assert.equal(
        SkycotFamily.lockRemainingMs({ lockedUntil: 10 * SkycotFamily.LOCKOUT_MS }, 0),
        SkycotFamily.LOCKOUT_MS,
      );
      assert.equal(SkycotFamily.lockRemainingMs({ lockedUntil: 1_000 }, 2_000), 0);
    });
  });

  describe("the code's length (for taking it on the last digit)", () => {
    it.effect(
      "is recorded when the code is set and changed, never in the status",
      () =>
        withFamily((family, filePath) =>
          Effect.gen(function* () {
            assert.isNull(yield* family.codeLength);
            const status = yield* family.enable({ code: CODE, childName: null });
            assert.notProperty(status, "codeLength");
            assert.equal(yield* family.codeLength, CODE.length);
            yield* family.changeCode({ oldCode: CODE, newCode: "7351" });
            assert.equal(yield* family.codeLength, 4);
            assert.notProperty(yield* family.status, "codeLength");
            const raw = yield* (yield* FileSystem.FileSystem).readFileString(filePath);
            assert.notInclude(raw, "7351");
            yield* family.disable({ code: "7351" });
            assert.isNull(yield* family.codeLength);
          }),
        ),
      // Three deliberately slow code hashes: room for them when every suite runs at once.
      30_000,
    );

    it.effect("an older code with no length learns it from the next right code only", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* family.enable({ code: CODE, childName: null });
          const { codeLength: _dropped, ...older } = JSON.parse(
            yield* fs.readFileString(filePath),
          ) as Record<string, unknown>;
          yield* fs.writeFileString(filePath, JSON.stringify(older));
          assert.isNull(yield* family.codeLength);
          // A wrong code teaches nothing.
          yield* failureOf(family.checkCode({ code: "1111" }));
          assert.isNull(yield* family.codeLength);
          // The right one (checkCode saves only when something changed: this is such a change).
          yield* family.checkCode({ code: CODE });
          assert.equal(yield* family.codeLength, CODE.length);
          // The five-try count is untouched by any of this.
          assert.equal((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS);
        }),
      ),
    );

    it("a hand-edited length no code could have counts as unknown", () => {
      assert.isNull(SkycotFamily.knownCodeLength({ enabled: true, codeLength: 9 }));
      assert.isNull(SkycotFamily.knownCodeLength({ enabled: true, codeLength: 4.5 }));
      assert.isNull(SkycotFamily.knownCodeLength({ enabled: false, codeLength: 4 }));
      assert.equal(SkycotFamily.knownCodeLength({ enabled: true, codeLength: 6 }), 6);
    });
  });

  describe("grants and tokens", () => {
    it.effect("everything is allowed while the profile is off", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          assert.isTrue(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
          assert.isTrue(yield* family.tokenAllows(undefined, "advanced"));
        }),
      ),
    );

    it.effect("a grant is for one session and one purpose, and runs out", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          assert.isFalse(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
          yield* family.verify({ code: CODE, purpose: "publish", sessionId: SESSION });
          assert.isTrue(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
          assert.isFalse(yield* family.allows({ sessionId: "session-child", purpose: "publish" }));
          assert.isFalse(yield* family.allows({ sessionId: SESSION, purpose: "automation" }));
          yield* TestClock.adjust(SkycotFamily.GRANT_TTL_MS.publish);
          assert.isFalse(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
        }),
      ),
    );

    it.effect("an approval grant is for one request and is spent once used", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          assert.equal(
            (yield* failureOf(
              family.verify({ code: CODE, purpose: "approve", sessionId: SESSION }),
            )).reason,
            "invalid-request",
          );
          yield* family.verify({
            code: CODE,
            purpose: "approve",
            sessionId: SESSION,
            requestId: "req-1",
          });
          assert.isFalse(
            yield* family.allows({ sessionId: SESSION, purpose: "approve", requestId: "req-2" }),
          );
          assert.isTrue(
            yield* family.allows({
              sessionId: SESSION,
              purpose: "approve",
              requestId: "req-1",
              consume: true,
            }),
          );
          assert.isFalse(
            yield* family.allows({ sessionId: SESSION, purpose: "approve", requestId: "req-1" }),
          );
        }),
      ),
    );

    it.effect("Advanced mode is the master grant; locking ends it", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          const unlock = yield* family.verify({
            code: CODE,
            purpose: "advanced",
            sessionId: SESSION,
          });
          assert.isTrue(yield* family.allows({ sessionId: SESSION, purpose: "automation" }));
          assert.isTrue(
            yield* family.allows({ sessionId: SESSION, purpose: "approve", requestId: "any" }),
          );
          assert.isTrue(yield* family.tokenAllows(unlock.token, "advanced"));
          yield* family.lock({ sessionId: SESSION });
          assert.isFalse(yield* family.allows({ sessionId: SESSION, purpose: "automation" }));
        }),
      ),
    );

    it.effect("a token is refused once expired, when forged, or for a smaller purpose", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          const publish = yield* family.verify({
            code: CODE,
            purpose: "publish",
            sessionId: SESSION,
          });
          assert.isFalse(yield* family.tokenAllows(publish.token, "advanced"));
          assert.isTrue(yield* family.tokenAllows(publish.token, "publish"));
          const [version, body] = publish.token.split(".");
          assert.isFalse(yield* family.tokenAllows(`${version}.${body}.forged`, "publish"));
          assert.isFalse(yield* family.tokenAllows("", "publish"));
          yield* TestClock.adjust(SkycotFamily.GRANT_TTL_MS.publish);
          assert.isFalse(yield* family.tokenAllows(publish.token, "publish"));
        }),
      ),
    );
  });

  it.effect("an unreadable profile file counts as off, never as a lock-out", () =>
    withFamily((family, filePath) =>
      Effect.gen(function* () {
        yield* (yield* FileSystem.FileSystem).writeFileString(filePath, "{ not json");
        assert.isFalse(yield* family.isEnabled);
        assert.isTrue(yield* family.allows({ sessionId: SESSION, purpose: "publish" }));
      }),
    ),
  );

  describe("several children (file version 2)", () => {
    const V1 = {
      version: 1,
      enabled: true,
      childName: "Ava",
      codeHash: "",
      salt: "0123456789abcdef0123456789abcdef",
      createdAt: "2026-10-01T00:00:00.000Z",
      failedAttempts: 2,
      lockedUntil: null,
      tokenSecret: "secret",
      grants: [],
    };

    it.effect("reads a version 1 file as one child, keeps the code, and writes version 2", () =>
      withFamily((family, filePath) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          // A real profile first, so the hash matches CODE; then rewritten in the old shape.
          yield* family.enable({ code: CODE, childName: null });
          const real = JSON.parse(yield* fs.readFileString(filePath)) as Record<string, unknown>;
          yield* fs.writeFileString(
            filePath,
            JSON.stringify({ ...V1, codeHash: real["codeHash"], salt: real["salt"] }),
          );
          const status = yield* family.status;
          assert.equal(status.childName, "Ava");
          assert.lengthOf(status.children, 1);
          const [ava] = status.children;
          assert.equal(ava!.name, "Ava");
          assert.equal(ava!.look, SkycotFamily.DEFAULT_LOOK);
          assert.isTrue(ava!.largerText);
          // Voice typing goes to the browser's speech service: off until a parent turns it on.
          assert.deepEqual(ava!.voice, { typing: false, readAloud: true });
          assert.deepEqual(ava!.limits, SkycotFamily.NO_LIMITS);
          assert.equal(status.attemptsLeft, SkycotFamily.MAX_ATTEMPTS - 2);
          // The same id on every read before the first write.
          assert.equal((yield* family.status).children[0]!.id, ava!.id);
          yield* family.verify({ code: CODE, purpose: "settings", sessionId: SESSION });
          const saved = JSON.parse(yield* fs.readFileString(filePath)) as Record<string, unknown>;
          assert.equal(saved["version"], SkycotFamily.FAMILY_FILE_VERSION);
          assert.notProperty(saved, "childName");
          assert.equal((saved["children"] as Array<{ id: string }>)[0]!.id, ava!.id);
        }),
      ),
    );

    it.effect("adds, updates and removes children; the last one stays", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          const first = yield* family.enable({ code: CODE, childName: "Ava" });
          const avaId = first.children[0]!.id;
          const { status, childId } = yield* family.addChild({
            name: "  Leo ",
            avatar: { kind: "mascot", pose: "yay" },
            look: "classic",
            largerText: false,
            readingLevel: "little-makers",
          });
          assert.lengthOf(status.children, 2);
          const leo = status.children.find((child) => child.id === childId)!;
          assert.equal(leo.name, "Leo");
          assert.deepEqual(leo.avatar, { kind: "mascot", pose: "yay" });
          assert.equal(leo.look, "classic");
          assert.isFalse(leo.largerText);
          assert.equal(leo.readingLevel, "little-makers");
          // A second letter picture never shares the first one's colour.
          assert.notDeepEqual(status.children[0]!.avatar, leo.avatar);

          const updated = yield* family.updateChild({
            childId,
            patch: {
              voice: { typing: true },
              limits: {
                bedtime: { start: "7:30", end: "7:00" },
                dailyMinutes: 9999,
                dailyTurns: null,
              },
              avatar: { kind: "mascot", pose: "not-a-pose" },
              readingLevel: "not-a-level",
            },
          });
          const changed = updated.children.find((child) => child.id === childId)!;
          assert.deepEqual(changed.voice, { typing: true, readAloud: true });
          assert.deepEqual(changed.limits, {
            bedtime: { start: "07:30", end: "07:00" },
            dailyMinutes: SkycotFamily.LIMIT_BOUNDS.dailyMinutes.max,
            dailyTurns: null,
            keepAllowancePercent: null,
          });
          assert.deepEqual(changed.avatar, leo.avatar);
          assert.equal(changed.readingLevel, "little-makers");

          const removed = yield* family.removeChild({ childId });
          assert.deepEqual(
            removed.children.map((child) => child.id),
            [avaId],
          );
          assert.equal(
            (yield* failureOf(family.removeChild({ childId: avaId }))).reason,
            "invalid-request",
          );
        }),
      ),
    );

    it.effect("checks a code for a one-off action and counts a wrong one", () =>
      withFamily((family) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: null });
          assert.equal(
            (yield* failureOf(family.checkCode({ code: "000000" }))).reason,
            "wrong-code",
          );
          assert.equal((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS - 1);
          yield* family.checkCode({ code: CODE });
          assert.equal((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS);
        }),
      ),
    );

    it.effect(
      "keeps the household's zone for bedtimes, ignoring one this engine does not know",
      () =>
        withFamily((family) =>
          Effect.gen(function* () {
            const on = yield* family.enable({
              code: CODE,
              childName: null,
              timeZone: "Australia/Melbourne",
            });
            assert.equal(on.timeZone, "Australia/Melbourne");
            assert.equal((yield* family.setTimeZone("Mars/Base")).timeZone, "UTC");
          }),
        ),
    );
  });
});
