// What SKYCOT remembers about add-ons, in `<T3 home>/userdata/skycot-add-ons.json` (0600, written
// atomically, capped):
//   - per conversation, the add-ons a grown-up said yes to, so the same add-on asked again in
//     that one conversation is the child's step for the next 7 days ("one yes covers repeats").
//     It never reaches another conversation, another add-on, or anything that is not an add-on
//     ask (the Family rules check all three, family.ts `reliefFor`);
//   - every add-on SKYCOT added by itself (a trusted add-on, or a repeat), for the grown-ups'
//     recap: "SKYCOT added three.js for Ava" (SkycotFamilyLimits reads this file; never writes).
// Missing or unreadable means empty: the worst case is one more question for a grown-up.

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

export const ADD_ON_FILE_NAME = "skycot-add-ons.json";
/** How long one grown-up yes covers the same add-on in the same conversation. */
export const REPEAT_APPROVAL_MS = 7 * 24 * 60 * 60_000;
const THREADS_KEEP = 200;
const NAMES_PER_THREAD = 20;
const ADDED_KEEP = 300;
const ADDED_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

const Approval = Schema.Struct({ name: Schema.String, at: Schema.Number });

const AddedEntry = Schema.Struct({
  at: Schema.Number,
  threadId: Schema.String,
  /** Package names ("three"). */
  names: Schema.Array(Schema.String),
  /** On the trusted list, or allowed by a grown-up earlier in the conversation. */
  how: Schema.Literals(["trusted", "again"]),
});
export type AddedEntry = typeof AddedEntry.Type;

const AddOnFile = Schema.Struct({
  version: Schema.Literal(1),
  approvals: Schema.Record(Schema.String, Schema.Array(Approval)),
  added: Schema.Array(AddedEntry),
});
export type AddOnFile = typeof AddOnFile.Type;

const EMPTY: AddOnFile = { version: 1, approvals: {}, added: [] };
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(AddOnFile));
const encodeFile = Schema.encodeEffect(Schema.fromJsonString(AddOnFile));

/** The file as kept, or empty. */
export const readAddOnFile = Effect.fn("SkycotAddOnApprovals.read")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  return Option.getOrElse(decodeFile(raw), () => EMPTY);
});

/** The add-ons a grown-up allowed in this one conversation that have not expired. */
export function approvedAddOnsFor(
  file: Pick<AddOnFile, "approvals">,
  threadId: string,
  now: number,
): ReadonlyArray<string> {
  return (file.approvals[threadId] ?? [])
    .filter((approval) => approval.at <= now && now - approval.at < REPEAT_APPROVAL_MS)
    .map((approval) => approval.name);
}

/** Pure: the file after a grown-up's yes to `names` in `threadId` (expired entries dropped). */
export function withApproval(
  file: AddOnFile,
  threadId: string,
  names: ReadonlyArray<string>,
  now: number,
): AddOnFile {
  const live = (list: ReadonlyArray<typeof Approval.Type>) =>
    list.filter((approval) => now - approval.at < REPEAT_APPROVAL_MS);
  // A name already allowed keeps its first time: a later yes never stretches the 7 days.
  const kept = live(file.approvals[threadId] ?? []);
  const fresh = names
    .filter((name, index) => names.indexOf(name) === index)
    .filter((name) => !kept.some((approval) => approval.name === name))
    .map((name) => ({ name, at: now }));
  const next = [...kept, ...fresh].slice(-NAMES_PER_THREAD);
  const others = Object.entries(file.approvals)
    .filter(([id]) => id !== threadId)
    .map(([id, list]) => [id, live(list)] as const)
    .filter(([, list]) => list.length > 0)
    .sort((a, b) => Math.max(...b[1].map((x) => x.at)) - Math.max(...a[1].map((x) => x.at)))
    .slice(0, THREADS_KEEP - 1);
  return { ...file, approvals: Object.fromEntries([...others, [threadId, next]]) };
}

/** Pure: the file after SKYCOT added an add-on by itself. */
export function withAdded(file: AddOnFile, entry: AddedEntry): AddOnFile {
  return {
    ...file,
    added: [...file.added, entry]
      .filter((logged) => logged.at > entry.at - ADDED_DAYS * DAY_MS)
      .slice(-ADDED_KEEP),
  };
}

export interface AddOnStore {
  readonly approve: (threadId: string, names: ReadonlyArray<string>) => Effect.Effect<void>;
  readonly recordAdded: (entry: Omit<AddedEntry, "at">) => Effect.Effect<void>;
}

/** The one writer (SkycotApprovedInstalls). Writes are serialised and atomic. */
export const makeAddOnStore = Effect.fn("SkycotAddOnApprovals.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);

  const save = Effect.fn("SkycotAddOnApprovals.save")(
    function* (file: AddOnFile) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeFile(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not save the SKYCOT add-on file.", { cause }),
    ),
  );

  const update = (change: (file: AddOnFile, now: number) => AddOnFile) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const file = yield* readAddOnFile(filePath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        );
        yield* save(change(file, yield* Clock.currentTimeMillis));
      }),
    );

  return {
    approve: (threadId, names) =>
      names.length === 0
        ? Effect.void
        : update((file, now) => withApproval(file, threadId, names, now)),
    recordAdded: (entry) => update((file, now) => withAdded(file, { ...entry, at: now })),
  } satisfies AddOnStore;
});
