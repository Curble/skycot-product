// nondev-seam: skycot-policy-files
// What the model fallback remembers, in `<T3 home>/userdata/skycot-assistant-switches.json`:
//   - per conversation, the model the person chose and the one SKYCOT moved it to while that
//     one was resting, so the next message goes back to the person's choice once it has reset
//     (their choice is never changed for good);
//   - every switch, for the one plain line the conversation shows ("Claude's top helper is
//     resting until Tuesday, so …") and, when it moved to another company, for the grown-ups'
//     Today and recap (SkycotFamilyLimits reads this file; it never writes it).
// Missing or unreadable means empty: the worst case is one turn on the person's own choice.

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

export const SWITCH_FILE_NAME = "skycot-assistant-switches.json";
const SWITCHES_KEEP = 500;
const SWITCH_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

const SwitchEnd = Schema.Struct({
  instanceId: Schema.String,
  driver: Schema.String,
  model: Schema.String,
});
export type SwitchEnd = typeof SwitchEnd.Type;

const SwitchEntry = Schema.Struct({
  at: Schema.Number,
  threadId: Schema.String,
  /** The message that ran on the new model: the person's own, or SKYCOT's continuation. */
  messageId: Schema.String,
  from: SwitchEnd,
  to: SwitchEnd,
  /** When the model asked for comes back (epoch ms), when known. */
  until: Schema.NullOr(Schema.Number),
  crossProvider: Schema.Boolean,
  /** The run a limit stopped half-way, when this switch carried it on. */
  continuationOf: Schema.optionalKey(Schema.String),
});
export type SwitchEntry = typeof SwitchEntry.Type;

const ThreadMemory = Schema.Struct({
  preferred: ModelSelection,
  fallback: ModelSelection,
});
export type ThreadMemory = typeof ThreadMemory.Type;

const SwitchFile = Schema.Struct({
  version: Schema.Literal(1),
  threads: Schema.Record(Schema.String, ThreadMemory),
  switches: Schema.Array(SwitchEntry),
});
type SwitchFile = typeof SwitchFile.Type;

const EMPTY: SwitchFile = { version: 1, threads: {}, switches: [] };
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(SwitchFile));
const encodeFile = Schema.encodeEffect(Schema.fromJsonString(SwitchFile));

/** The file as kept, or empty. For readers (the grown-ups' Today and recap, the switches route). */
export const readSwitchFile = Effect.fn("SkycotSwitchLog.read")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  return Option.getOrElse(decodeFile(raw), () => EMPTY);
});

export const switchesForThread = (file: Pick<SwitchFile, "switches">, threadId: string) =>
  file.switches.filter((entry) => entry.threadId === threadId);

export interface SwitchStore {
  readonly memoryFor: (threadId: string) => Effect.Effect<ThreadMemory | null>;
  readonly remember: (threadId: string, memory: ThreadMemory) => Effect.Effect<void>;
  readonly forget: (threadId: string) => Effect.Effect<void>;
  readonly record: (entry: SwitchEntry) => Effect.Effect<void>;
  readonly switchesFor: (threadId: string) => Effect.Effect<ReadonlyArray<SwitchEntry>>;
}

/** The writer: one per engine (the model fallback). Writes are serialised and atomic. */
export const makeSwitchStore = Effect.fn("SkycotSwitchLog.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make<SwitchFile | null>(null);

  const load = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (cached !== null) return cached;
    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const file = Option.getOrElse(decodeFile(raw), () => EMPTY);
    yield* Ref.set(cache, file);
    return file;
  });

  const save = Effect.fn("SkycotSwitchLog.save")(
    function* (file: SwitchFile) {
      yield* Ref.set(cache, file);
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeFile(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not save the assistant switch file.", { cause }),
    ),
  );

  const update = (change: (file: SwitchFile) => SwitchFile) =>
    lock.withPermits(1)(load.pipe(Effect.flatMap((file) => save(change(file)))));

  return {
    memoryFor: (threadId) => load.pipe(Effect.map((file) => file.threads[threadId] ?? null)),
    remember: (threadId, memory) =>
      update((file) => ({ ...file, threads: { ...file.threads, [threadId]: memory } })),
    forget: (threadId) =>
      load.pipe(
        Effect.flatMap((file) =>
          file.threads[threadId] === undefined
            ? Effect.void
            : update((current) => {
                const { [threadId]: _gone, ...threads } = current.threads;
                return { ...current, threads };
              }),
        ),
      ),
    record: (entry) =>
      update((file) => ({
        ...file,
        switches: [...file.switches, entry]
          .filter((logged) => logged.at > entry.at - SWITCH_DAYS * DAY_MS)
          .slice(-SWITCHES_KEEP),
      })),
    switchesFor: (threadId) => load.pipe(Effect.map((file) => switchesForThread(file, threadId))),
  } satisfies SwitchStore;
});

/** For tests and stripped-down servers: the same store, kept in memory only. */
export const makeMemorySwitchStore = Effect.gen(function* () {
  const state = yield* Ref.make<SwitchFile>(EMPTY);
  return {
    memoryFor: (threadId) =>
      Ref.get(state).pipe(Effect.map((file) => file.threads[threadId] ?? null)),
    remember: (threadId, memory) =>
      Ref.update(state, (file) => ({ ...file, threads: { ...file.threads, [threadId]: memory } })),
    forget: (threadId) =>
      Ref.update(state, (file) => {
        const { [threadId]: _gone, ...threads } = file.threads;
        return { ...file, threads };
      }),
    record: (entry) =>
      Ref.update(state, (file) => ({ ...file, switches: [...file.switches, entry] })),
    switchesFor: (threadId) =>
      Ref.get(state).pipe(Effect.map((file) => switchesForThread(file, threadId))),
  } satisfies SwitchStore;
});
