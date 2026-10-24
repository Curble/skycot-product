// Small, bounded cross-device notes. The relay carries only a wake-up kind; text and answers
// stay in this file and are fetched over the authenticated Family routes.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";

export const FILE_NAME = "skycot-family-notes.json";
export type Note =
  | {
      readonly id: string;
      readonly kind: "shown";
      readonly childId: string;
      readonly createdAt: string;
      readonly status: "open" | "done";
      readonly threadId: string;
      readonly title: string;
    }
  | {
      readonly id: string;
      readonly kind: "more-time";
      readonly childId: string;
      readonly createdAt: string;
      readonly status: "open" | "done";
      readonly answer?: { readonly minutes: 0 | 15 | 30; readonly by: string; readonly at: string };
    };

const NoteSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("shown"),
    childId: Schema.String,
    createdAt: Schema.String,
    status: Schema.Literals(["open", "done"]),
    threadId: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("more-time"),
    childId: Schema.String,
    createdAt: Schema.String,
    status: Schema.Literals(["open", "done"]),
    answer: Schema.optionalKey(
      Schema.Struct({
        minutes: Schema.Literals([0, 15, 30]),
        by: Schema.String,
        at: Schema.String,
      }),
    ),
  }),
]);
const FileSchema = Schema.Struct({ version: Schema.Literal(1), notes: Schema.Array(NoteSchema) });
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(FileSchema));
const encode = Schema.encodeEffect(Schema.fromJsonString(FileSchema));
const empty = { version: 1 as const, notes: [] as ReadonlyArray<Note> };
const MAX_NOTES = 50;
const WEEK = 7 * 24 * 60 * 60 * 1000;

export class SkycotFamilyNotes extends Context.Service<
  SkycotFamilyNotes,
  {
    readonly create: (input: {
      readonly kind: Note["kind"];
      readonly childId: string;
      readonly threadId?: string;
      readonly title?: string;
    }) => Effect.Effect<Note>;
    readonly own: (childId: string) => Effect.Effect<ReadonlyArray<Note>>;
    readonly open: Effect.Effect<ReadonlyArray<Note>>;
    readonly answer: (input: {
      readonly id: string;
      readonly minutes: 0 | 15 | 30;
      readonly by: string;
    }) => Effect.Effect<Note | null>;
    readonly seen: (id: string) => Effect.Effect<boolean>;
  }
>()("t3/skycot/family-notes/SkycotFamilyNotes") {}

/** An open note this request would only repeat: same child, same kind (and same thing shown). */
export function sameOpenNote(
  note: Note,
  input: { readonly kind: Note["kind"]; readonly childId: string; readonly threadId?: string },
): boolean {
  if (note.status !== "open" || note.kind !== input.kind || note.childId !== input.childId)
    return false;
  return note.kind !== "shown" || note.threadId === (input.threadId ?? "");
}

export const makeAt = Effect.fn("SkycotFamilyNotes.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const read = fs.readFileString(filePath).pipe(
    Effect.map((raw) => {
      const parsed = decode(raw);
      return parsed._tag === "Some" ? parsed.value : empty;
    }),
    Effect.orElseSucceed(() => empty),
  );
  const save = Effect.fn("SkycotFamilyNotes.save")(
    function* (notes: ReadonlyArray<Note>) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encode({ version: 1, notes })}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not save the Family notes file.", { cause }),
    ),
  );
  const cleaned = (notes: ReadonlyArray<Note>, now: number) =>
    notes
      .filter((note) => note.status === "open" || now - Date.parse(note.createdAt) < WEEK)
      .slice(-MAX_NOTES);
  const create: SkycotFamilyNotes["Service"]["create"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const current = yield* read;
        // A child tapping again reuses the open note, so repeats never pile up or re-buzz a phone.
        const repeat = current.notes.find((note) => sameOpenNote(note, input));
        if (repeat !== undefined) return repeat;
        const createdAt = DateTime.formatIso(DateTime.makeUnsafe(at));
        const note: Note =
          input.kind === "shown"
            ? {
                id: NodeCrypto.randomUUID(),
                kind: "shown",
                childId: input.childId,
                createdAt,
                status: "open",
                threadId: input.threadId ?? "",
                title: (input.title ?? "Something they made").slice(0, 100),
              }
            : {
                id: NodeCrypto.randomUUID(),
                kind: "more-time",
                childId: input.childId,
                createdAt,
                status: "open",
              };
        yield* save(cleaned([...current.notes, note], at));
        return note;
      }),
    );
  const own: SkycotFamilyNotes["Service"]["own"] = (childId) =>
    read.pipe(Effect.map((file) => file.notes.filter((note) => note.childId === childId)));
  const open: SkycotFamilyNotes["Service"]["open"] = read.pipe(
    Effect.map((file) => file.notes.filter((note) => note.status === "open")),
  );
  const answer: SkycotFamilyNotes["Service"]["answer"] = (input) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const file = yield* read;
        const found = file.notes.find(
          (note) => note.id === input.id && note.status === "open" && note.kind === "more-time",
        );
        if (found === undefined || found.kind !== "more-time") return null;
        const next: Note = {
          ...found,
          status: "done",
          answer: {
            minutes: input.minutes,
            by: input.by.split(/\s+/)[0] ?? "A grown-up",
            at: DateTime.formatIso(DateTime.makeUnsafe(at)),
          },
        };
        yield* save(
          cleaned(
            file.notes.map((note) => (note.id === input.id ? next : note)),
            at,
          ),
        );
        return next;
      }),
    );
  const seen: SkycotFamilyNotes["Service"]["seen"] = (id) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const file = yield* read;
        const found = file.notes.find(
          (note) => note.id === id && note.kind === "shown" && note.status === "open",
        );
        if (found === undefined) return false;
        yield* save(
          cleaned(
            file.notes.map((note) =>
              note.id === id ? { ...note, status: "done" as const } : note,
            ),
            at,
          ),
        );
        return true;
      }),
    );
  return SkycotFamilyNotes.of({ create, own, open, answer, seen });
});

export const layerAt = (filePath: string) => Layer.effect(SkycotFamilyNotes, makeAt(filePath));
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, FILE_NAME));
  }),
);
