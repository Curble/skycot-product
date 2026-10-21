import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as SkycotFamily from "./SkycotFamily.ts";

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
          assert.deepEqual(yield* family.status, {
            enabled: false,
            childName: null,
            createdAt: null,
            attemptsLeft: SkycotFamily.MAX_ATTEMPTS,
            lockedForMs: 0,
          });
          const status = yield* family.enable({ code: CODE, childName: "  Ava  " });
          assert.isTrue(status.enabled);
          assert.equal(status.childName, "Ava");
          assert.notProperty(status, "codeHash");
          const raw = yield* (yield* FileSystem.FileSystem).readFileString(filePath);
          assert.notInclude(raw, CODE);
          assert.isTrue(yield* family.isEnabled);
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

  it("MCP credentials keep only previews while the profile is on", () => {
    assert.deepEqual(
      [
        ...SkycotFamily.keepFamilyMcpCapabilities(
          new Set(["orchestration", "worktree", "pull-requests", "preview", "device"]),
        ),
      ],
      ["preview"],
    );
  });
});
