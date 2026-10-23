// Every assistant in the Family profile, as the parent's informed choice: an assistant SKYCOT
// can't lock down starts for a child only after a grown-up allowed it with the parent code,
// through the real profile file and the real lockdown wrapper.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ProviderSessionId } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { notAllowedSentence } from "@t3tools/skycot-rules/assistants";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

const CODE = "482913";

type Runtime = ProviderAdapter.ProviderAdapterV2SessionRuntime;
type Adapter = ProviderAdapter.ProviderAdapterV2["Service"];

/** An adapter that records the lockdown it was opened with and counts its runtime's calls. */
function fakeAdapter(driver: string) {
  const seen: Array<SkycotFamilyLockdown.FamilyLockdown | null> = [];
  const calls: Array<string> = [];
  const record = (name: string) => () =>
    Effect.sync(() => {
      calls.push(name);
    }) as never;
  const adapter = {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    openSession: () =>
      SkycotFamilyLockdown.sessionLockdown.pipe(
        Effect.map((lockdown) => {
          seen.push(lockdown);
          return {
            instanceId: ProviderInstanceId.make(driver),
            driver: ProviderDriverKind.make(driver),
            providerSessionId: ProviderSessionId.make(`session-${driver}`),
            ensureThread: record("ensureThread"),
            resumeThread: record("resumeThread"),
            forkThread: record("forkThread"),
            startTurn: record("startTurn"),
            steerTurn: record("steerTurn"),
            interruptTurn: record("interruptTurn"),
          } as unknown as Runtime;
        }),
      ),
  } as unknown as Adapter;
  return { adapter, seen, calls };
}

const openInput = {
  providerSessionId: ProviderSessionId.make("session-open"),
} as unknown as Parameters<Adapter["openSession"]>[0];

/** A fresh profile file, the service over it, and a way to open a session through the lockdown. */
const withFamily = <A, E, R>(
  use: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly filePath: string;
    readonly open: (driver: string) => ReturnType<typeof openThrough>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-any-ai-" });
    const filePath = path.join(dir, SkycotFamily.FAMILY_FILE_NAME);
    const family = yield* Effect.provide(SkycotFamily.SkycotFamily, SkycotFamily.layerAt(filePath));
    return yield* use({ family, filePath, open: (driver) => openThrough(family, driver) });
  }).pipe(Effect.scoped);

const openThrough = (family: SkycotFamily.SkycotFamily["Service"], driver: string) => {
  const fake = fakeAdapter(driver);
  return Effect.scoped(
    SkycotFamilyLockdown.lockAdapter(family, fake.adapter).openSession(openInput),
  ).pipe(
    Effect.result,
    Effect.map((result) => ({ result, ...fake })),
  );
};

const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.flip(effect);

it.layer(NodeServices.layer)("Family profile: any assistant, as a grown-up's choice", (it) => {
  describe("an assistant SKYCOT can't lock down", () => {
    it.effect("is refused while nobody allowed it, before it starts", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          for (const driver of ["cursor", "opencode", "grok", "antigravity", "pi", "muse", "acp"]) {
            const { result, seen } = yield* open(driver);
            assert.strictEqual(result._tag, "Failure", `${driver} must be refused`);
            assert.lengthOf(seen, 0, `${driver} must not start at all`);
            if (result._tag === "Failure") {
              assert.strictEqual(result.failure.message, notAllowedSentence(driver));
            }
          }
          const cursor = yield* open("cursor");
          if (cursor.result._tag === "Failure") {
            assert.include(cursor.result.failure.message, "A grown-up can allow Cursor");
            assert.include(cursor.result.failure.message, "Settings › Family");
          }
        }),
      ),
    );

    it.effect("starts unlocked once a grown-up allowed it with the parent code", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          const status = yield* family.allowAssistant({ code: CODE, driver: "cursor" });
          assert.deepEqual(status.allowedAssistants, ["cursor"]);
          assert.deepEqual((yield* family.status).allowedAssistants, ["cursor"]);

          const { result, seen, calls } = yield* open("cursor");
          assert.strictEqual(result._tag, "Success");
          if (result._tag !== "Success") return;
          // Unlocked: no lockdown handed to the adapter, and not remembered as locked.
          assert.deepEqual(seen, [null]);
          assert.isFalse(SkycotFamilyLockdown.isLocked(result.success));
          yield* result.success.startTurn({} as never);
          assert.deepEqual(calls, ["startTurn"]);

          // Only that one: another assistant is still refused.
          assert.strictEqual((yield* open("opencode")).result._tag, "Failure");
        }),
      ),
    );

    it.effect("a wrong code allows nothing and counts towards the five tries", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          const wrong = yield* failure(family.allowAssistant({ code: "000000", driver: "cursor" }));
          assert.strictEqual(wrong.reason, "wrong-code");
          assert.strictEqual(wrong.attemptsLeft, SkycotFamily.MAX_ATTEMPTS - 1);
          assert.strictEqual((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS - 1);
          assert.deepEqual((yield* family.status).allowedAssistants, []);
          assert.strictEqual((yield* open("cursor")).result._tag, "Failure");

          // The same counter as every other code prompt: the rest of the tries lock it.
          for (let i = 0; i < SkycotFamily.MAX_ATTEMPTS - 2; i++) {
            yield* failure(family.checkCode({ code: "111111" }));
          }
          const locked = yield* failure(
            family.allowAssistant({ code: "222222", driver: "cursor" }),
          );
          assert.strictEqual(locked.reason, "locked");
          const stillLocked = yield* failure(
            family.allowAssistant({ code: CODE, driver: "cursor" }),
          );
          assert.strictEqual(stillLocked.reason, "locked");
          assert.deepEqual((yield* family.status).allowedAssistants, []);
        }),
      ),
    );

    it.effect("stop allowing refuses its next Family turn and closes its session", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          yield* family.allowAssistant({ code: CODE, driver: "cursor" });
          const { result, calls } = yield* open("cursor");
          assert.strictEqual(result._tag, "Success");
          if (result._tag !== "Success") return;
          const runtime = result.success;
          yield* runtime.startTurn({} as never);

          // Kept while it is allowed: the session manager does not restart it.
          const released: Array<string> = [];
          const release = SkycotFamilyLockdown.releaseIfMismatched(
            Option.some(family),
            { runtime, busyTurns: new Set() },
            (detail) => Effect.sync(() => void released.push(detail)),
          );
          yield* release;
          assert.lengthOf(released, 0);

          // No code needed to take it back: it only makes the profile stricter.
          const status = yield* family.stopAllowingAssistant({ driver: "cursor" });
          assert.deepEqual(status.allowedAssistants, []);

          // The live session refuses the next turn at once, with the grown-up's sentence...
          const refused = yield* failure(runtime.startTurn({} as never));
          assert.strictEqual(refused.message, notAllowedSentence("cursor"));
          for (const call of [
            runtime.ensureThread({} as never),
            runtime.resumeThread({} as never),
            runtime.steerTurn({} as never),
          ]) {
            yield* failure(call);
          }
          // ...stopping still works, so a grown-up can end what was running...
          yield* runtime.interruptTurn({} as never);
          assert.deepEqual(calls, ["startTurn", "interruptTurn"]);
          // ...the session manager closes it before its next use...
          yield* release;
          assert.lengthOf(released, 1);
          // ...and a fresh open is refused before anything starts.
          const reopened = yield* open("cursor");
          assert.strictEqual(reopened.result._tag, "Failure");
          assert.lengthOf(reopened.seen, 0);
        }),
      ),
    );

    it.effect("an allowance is forgotten when the profile is turned off", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          yield* family.allowAssistant({ code: CODE, driver: "cursor" });
          yield* family.disable({ code: CODE });
          yield* family.enable({ code: CODE, childName: "Ava" });
          assert.deepEqual((yield* family.status).allowedAssistants, []);
          assert.strictEqual((yield* open("cursor")).result._tag, "Failure");
        }),
      ),
    );
  });

  describe("Codex and Claude", () => {
    it.effect("stay locked down and need no allowance (and cannot be given one)", () =>
      withFamily(({ family, filePath, open }) =>
        Effect.gen(function* () {
          yield* family.enable({ code: CODE, childName: "Ava" });
          for (const driver of ["codex", "claudeAgent"]) {
            const { result, seen } = yield* open(driver);
            assert.strictEqual(result._tag, "Success");
            assert.strictEqual(seen[0]?.driver, driver);
            if (result._tag === "Success") {
              assert.isTrue(SkycotFamilyLockdown.isLocked(result.success));
            }
            const refused = yield* failure(family.allowAssistant({ code: CODE, driver }));
            assert.strictEqual(refused.reason, "invalid-request");
          }
          // Refused before the code is checked: no try was used up.
          assert.strictEqual((yield* family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS);

          // A hand-edited file cannot unlock them either.
          const fs = yield* FileSystem.FileSystem;
          const raw = JSON.parse(yield* fs.readFileString(filePath)) as Record<string, unknown>;
          yield* fs.writeFileString(
            filePath,
            JSON.stringify({ ...raw, allowedAssistants: ["codex", "claudeAgent", "cursor"] }),
          );
          assert.deepEqual((yield* family.status).allowedAssistants, ["cursor"]);
          for (const driver of ["codex", "claudeAgent"]) {
            const { result, seen } = yield* open(driver);
            assert.strictEqual(seen[0]?.driver, driver, `${driver} still opens locked`);
            if (result._tag === "Success") {
              assert.isTrue(SkycotFamilyLockdown.isLocked(result.success));
            }
          }
        }),
      ),
    );
  });

  describe("with the profile off", () => {
    it.effect("every assistant opens as upstream would, and nothing can be allowed", () =>
      withFamily(({ family, open }) =>
        Effect.gen(function* () {
          for (const driver of ["codex", "cursor"]) {
            const { result, seen } = yield* open(driver);
            assert.strictEqual(result._tag, "Success");
            assert.deepEqual(seen, [null]);
          }
          const refused = yield* failure(family.allowAssistant({ code: CODE, driver: "cursor" }));
          assert.strictEqual(refused.reason, "not-enabled");
          assert.deepEqual((yield* family.status).allowedAssistants, []);
        }),
      ),
    );
  });
});
