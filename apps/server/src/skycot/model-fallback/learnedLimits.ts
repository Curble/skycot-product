// nondev-seam: skycot-policy-files
// What usage-limit failures taught the model fallback, kept across engine restarts in
// `<T3 home>/userdata/skycot-assistant-limits.json`, next to the switch file.
//
// Why: Claude's usage probe does not report every allowance (Fable's own week, Opus's and
// Sonnet's weekly windows are not passed through), so for those SKYCOT only learns that a model
// is resting from a turn that stopped on it. Kept in memory only, a restart forgot it and the next
// turn failed once more. Each entry is one provider instance, one model (or, with `model` null,
// the whole account) and the time it comes back; an entry whose time has passed is dropped on
// load and on every write, the file holds at most `LIMITS_KEEP` entries, and it is written
// atomically with owner-only permissions. A turn that completes on a model is the best evidence
// it is back, so it clears what was learned against that model (`forgetFor`).
// Missing or unreadable means empty: the worst case is one failed turn, as before.

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type { LearnedLimit, ModelRef } from "./availability.ts";

export const LIMITS_FILE_NAME = "skycot-assistant-limits.json";
/** One per resting model is the normal case; this only bounds a file nothing else trims. */
export const LIMITS_KEEP = 200;
/** No allowance SKYCOT knows of rests longer than a week; a farther time is a bad report. */
const LONGEST_REST_MS = 8 * 24 * 60 * 60_000;

const LimitEntry = Schema.Struct({
  instanceId: Schema.String,
  model: Schema.NullOr(Schema.String),
  until: Schema.Number,
  /** When the failure taught it (epoch ms). */
  learnedAt: Schema.Number,
});
type LimitEntry = typeof LimitEntry.Type;

const LimitFile = Schema.Struct({
  version: Schema.Literal(1),
  limits: Schema.Array(LimitEntry),
});
type LimitFile = typeof LimitFile.Type;

const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(LimitFile));
const encodeFile = Schema.encodeEffect(Schema.fromJsonString(LimitFile));

export interface LearnedLimitStore {
  /** Everything still resting at `now`. */
  readonly current: (now: number) => Effect.Effect<ReadonlyArray<LearnedLimit>>;
  /** Remember what failures taught (the later reset wins for the same model). */
  readonly learn: (entries: ReadonlyArray<LearnedLimit>, now: number) => Effect.Effect<void>;
  /**
   * A turn that started at `startedAt` completed on this model: what was learned against it (or
   * its account) before then is wrong now. `sameModel` matches a slug with its aliases.
   */
  readonly forgetFor: (
    ref: ModelRef,
    startedAt: number,
    sameModel?: (left: string, right: string) => boolean,
  ) => Effect.Effect<void>;
}

const keyOf = (entry: Pick<LearnedLimit, "instanceId" | "model">) =>
  `${entry.instanceId}\u0000${entry.model ?? ""}`;

/** Pure: the entries worth keeping at `now`, one per model, newest lesson last, capped. */
export function keptLimits(
  entries: ReadonlyArray<LimitEntry>,
  now: number,
): ReadonlyArray<LimitEntry> {
  const byKey = new Map<string, LimitEntry>();
  for (const entry of entries) {
    if (
      !Number.isFinite(entry.until) ||
      entry.until <= now ||
      entry.until > now + LONGEST_REST_MS ||
      entry.instanceId.length === 0
    ) {
      continue;
    }
    const key = keyOf(entry);
    const known = byKey.get(key);
    if (known === undefined || entry.until >= known.until) {
      byKey.delete(key);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].slice(-LIMITS_KEEP);
}

const toLearned = (entry: LimitEntry): LearnedLimit => ({
  instanceId: entry.instanceId,
  model: entry.model,
  until: entry.until,
});

/**
 * Pure: the entries a turn that started at `startedAt` and completed on `ref` leaves. The model it
 * ran on is back, and so is its account; only lessons from before the turn started are undone (a
 * turn already running when another one stopped can still finish). `sameModel` says whether a
 * learned model name is that model (slug or alias).
 */
export function afterCompletedTurn(
  entries: ReadonlyArray<LimitEntry>,
  ref: ModelRef,
  startedAt: number,
  sameModel: (left: string, right: string) => boolean = (left, right) => left === right,
): ReadonlyArray<LimitEntry> {
  return entries.filter(
    (entry) =>
      entry.instanceId !== ref.instanceId ||
      entry.learnedAt >= startedAt ||
      (entry.model !== null && !sameModel(entry.model, ref.model)),
  );
}

/** The store, kept in `filePath`. One per engine (the model fallback); writes are serialised. */
export const makeLearnedLimitStore = Effect.fn("SkycotLearnedLimits.make")(function* (
  filePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  const loaded = Option.match(decodeFile(raw), {
    onNone: () => [] as ReadonlyArray<LimitEntry>,
    onSome: (file) => file.limits,
  });
  const state = yield* Ref.make<ReadonlyArray<LimitEntry>>(loaded);

  const save = Effect.fn("SkycotLearnedLimits.save")(
    function* (limits: ReadonlyArray<LimitEntry>) {
      const file: LimitFile = { version: 1, limits };
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeFile(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not save the assistant limits file.", { cause }),
    ),
  );

  const update = (change: (limits: ReadonlyArray<LimitEntry>) => ReadonlyArray<LimitEntry>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* Ref.get(state);
        const after = change(before);
        yield* Ref.set(state, after);
        if (after !== before) yield* save(after);
      }),
    );

  const store: LearnedLimitStore = {
    current: (now) =>
      Ref.get(state).pipe(Effect.map((limits) => keptLimits(limits, now).map(toLearned))),
    learn: (entries, now) =>
      entries.length === 0
        ? Effect.void
        : update((limits) =>
            keptLimits([...limits, ...entries.map((entry) => ({ ...entry, learnedAt: now }))], now),
          ),
    forgetFor: (ref, startedAt, sameModel) =>
      update((limits) => {
        const kept = afterCompletedTurn(limits, ref, startedAt, sameModel);
        return kept.length === limits.length ? limits : kept;
      }),
  };
  return store;
});

/** For tests and stripped-down servers: the same store, kept in memory only. */
export const makeMemoryLearnedLimitStore = Effect.gen(function* () {
  const state = yield* Ref.make<ReadonlyArray<LimitEntry>>([]);
  const store: LearnedLimitStore = {
    current: (now) =>
      Ref.get(state).pipe(Effect.map((limits) => keptLimits(limits, now).map(toLearned))),
    learn: (entries, now) =>
      Ref.update(state, (limits) =>
        keptLimits([...limits, ...entries.map((entry) => ({ ...entry, learnedAt: now }))], now),
      ),
    forgetFor: (ref, startedAt, sameModel) =>
      Ref.update(state, (limits) => afterCompletedTurn(limits, ref, startedAt, sameModel)),
  };
  return store;
});
