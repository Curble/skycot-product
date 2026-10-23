import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, ProviderSessionId } from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyLockdown from "./SkycotFamilyLockdown.ts";

type Runtime = ProviderAdapter.ProviderAdapterV2SessionRuntime;
type Adapter = ProviderAdapter.ProviderAdapterV2["Service"];

const family = (on: Ref.Ref<boolean>) =>
  ({ isEnabled: Ref.get(on) }) as unknown as SkycotFamily.SkycotFamily["Service"];

/** A runtime whose work methods only count calls. */
function fakeRuntime(driver: string, calls: Array<string>): Runtime {
  const record = (name: string) => () =>
    Effect.sync(() => {
      calls.push(name);
    }) as never;
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
}

function fakeAdapter(driver: string, seen: Array<SkycotFamilyLockdown.FamilyLockdown | null>) {
  const calls: Array<string> = [];
  const adapter = {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    openSession: () =>
      SkycotFamilyLockdown.sessionLockdown.pipe(
        Effect.map((lockdown) => {
          seen.push(lockdown);
          return fakeRuntime(driver, calls);
        }),
      ),
  } as unknown as Adapter;
  return { adapter, calls };
}

const openInput = {
  providerSessionId: ProviderSessionId.make("session-open"),
} as unknown as Parameters<Adapter["openSession"]>[0];

describe("SkycotFamilyLockdown.lockAdapter", () => {
  it.effect("opens Codex and Claude under the lockdown while the profile is on", () =>
    Effect.gen(function* () {
      const on = yield* Ref.make(true);
      for (const driver of ["codex", "claudeAgent"]) {
        const seen: Array<SkycotFamilyLockdown.FamilyLockdown | null> = [];
        const { adapter } = fakeAdapter(driver, seen);
        const runtime = yield* Effect.scoped(
          SkycotFamilyLockdown.lockAdapter(family(on), adapter).openSession(openInput),
        );
        assert.strictEqual(seen[0]?.driver, driver);
        assert.isTrue(SkycotFamilyLockdown.isLocked(runtime));
      }
    }),
  );

  it.effect("refuses every other provider before it starts, with a plain sentence", () =>
    Effect.gen(function* () {
      const on = yield* Ref.make(true);
      for (const driver of ["cursor", "opencode", "grok", "antigravity", "pi", "muse", "acp"]) {
        const seen: Array<SkycotFamilyLockdown.FamilyLockdown | null> = [];
        const { adapter } = fakeAdapter(driver, seen);
        const error = yield* Effect.scoped(
          SkycotFamilyLockdown.lockAdapter(family(on), adapter).openSession(openInput),
        ).pipe(Effect.flip);
        assert.lengthOf(seen, 0, `${driver} must not start at all`);
        assert.strictEqual(error._tag, "ProviderAdapterOpenSessionError");
        assert.include(error.message, "The Family profile is on, and SKYCOT can't switch off");
        assert.include(error.message, "A grown-up can pick Codex or Claude");
      }
    }),
  );

  it.effect("opens exactly as upstream while the profile is off", () =>
    Effect.gen(function* () {
      const on = yield* Ref.make(false);
      for (const driver of ["codex", "cursor"]) {
        const seen: Array<SkycotFamilyLockdown.FamilyLockdown | null> = [];
        const { adapter, calls } = fakeAdapter(driver, seen);
        const runtime = yield* Effect.scoped(
          SkycotFamilyLockdown.lockAdapter(family(on), adapter).openSession(openInput),
        );
        assert.deepEqual(seen, [null]);
        assert.isFalse(SkycotFamilyLockdown.isLocked(runtime));
        yield* runtime.startTurn({} as never);
        yield* runtime.steerTurn({} as never);
        assert.deepEqual(calls, ["startTurn", "steerTurn"]);
      }
    }),
  );

  it.effect("an unlocked session refuses work once the profile is switched on", () =>
    Effect.gen(function* () {
      const on = yield* Ref.make(false);
      const { adapter, calls } = fakeAdapter("codex", []);
      const runtime = yield* Effect.scoped(
        SkycotFamilyLockdown.lockAdapter(family(on), adapter).openSession(openInput),
      );
      yield* Ref.set(on, true);
      for (const call of [
        runtime.ensureThread({} as never),
        runtime.resumeThread({} as never),
        runtime.forkThread({} as never),
        runtime.startTurn({} as never),
        runtime.steerTurn({} as never),
      ]) {
        const error = yield* Effect.flip(call);
        assert.include(error.message, "was switched on while Codex was already running");
      }
      yield* runtime.interruptTurn({} as never);
      assert.deepEqual(calls, ["interruptTurn"]);
    }),
  );
});

describe("SkycotFamilyLockdown.releaseIfMismatched", () => {
  const check = (
    on: boolean,
    locked: boolean,
    busy: number,
  ): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const flag = yield* Ref.make(on);
      const runtime = fakeRuntime("codex", []);
      if (locked) SkycotFamilyLockdown.markLocked(runtime);
      const released: Array<string> = [];
      yield* SkycotFamilyLockdown.releaseIfMismatched(
        Option.some(family(flag)),
        { runtime, busyTurns: new Set(Array.from({ length: busy }, (_, i) => `turn-${i}`)) },
        (detail) =>
          Effect.sync(() => {
            released.push(detail);
          }),
      );
      return released;
    });

  it.effect("closes an unlocked session as soon as the profile is on, even mid-turn", () =>
    Effect.gen(function* () {
      assert.lengthOf(yield* check(true, false, 0), 1);
      assert.lengthOf(yield* check(true, false, 1), 1);
    }),
  );

  it.effect("keeps a locked session while the profile is on", () =>
    Effect.gen(function* () {
      assert.lengthOf(yield* check(true, true, 0), 0);
    }),
  );

  it.effect("gives the parent their setup back once a locked session is idle", () =>
    Effect.gen(function* () {
      assert.lengthOf(yield* check(false, true, 0), 1);
      assert.lengthOf(yield* check(false, true, 1), 0);
      assert.lengthOf(yield* check(false, false, 0), 0);
    }),
  );

  it.effect("does nothing without the Family service (stock T3 Code)", () =>
    Effect.gen(function* () {
      const released: Array<string> = [];
      yield* SkycotFamilyLockdown.releaseIfMismatched(
        Option.none(),
        { runtime: {}, busyTurns: new Set() },
        (detail) => Effect.sync(() => void released.push(detail)),
      );
      assert.lengthOf(released, 0);
    }),
  );
});
