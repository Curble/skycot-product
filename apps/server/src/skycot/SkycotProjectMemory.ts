// nondev-seam: skycot-project-memory
// Engine-owned project facts used to keep SKYCOT's first-run flow quiet. No write operation is
// exposed over HTTP: folder records come from engine creation, and start records from approval.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

export const PROJECT_MEMORY_FILE = "skycot-project-memory.json";
export const MAX_CREATED_FOLDERS = 200;
export const MAX_REMEMBERED_STARTS = 200;

const CreatedFolder = Schema.Struct({
  realPath: Schema.String,
  createdBy: Schema.Literal("skycot"),
  childId: Schema.optionalKey(Schema.String),
  createdAt: Schema.Number,
});
const RememberedStart = Schema.Struct({
  id: Schema.String,
  projectRealPath: Schema.String,
  exactCommand: Schema.String,
  approvedBy: Schema.String,
  how: Schema.Literals(["parent-code", "face-id", "watch", "grown-up-session"]),
  createdAt: Schema.Number,
});
const MemoryFile = Schema.Struct({
  version: Schema.Literal(1),
  createdFolders: Schema.Array(CreatedFolder),
  rememberedStarts: Schema.Array(RememberedStart),
});
type MemoryFile = typeof MemoryFile.Type;
export type CreatedFolder = typeof CreatedFolder.Type;
export type RememberedStart = typeof RememberedStart.Type;

const EMPTY: MemoryFile = { version: 1, createdFolders: [], rememberedStarts: [] };
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(MemoryFile));
const encode = Schema.encodeEffect(Schema.fromJsonString(MemoryFile));

export class SkycotProjectMemory extends Context.Service<
  SkycotProjectMemory,
  {
    readonly recordCreatedFolder: (input: {
      readonly path: string;
      readonly childId?: string;
    }) => Effect.Effect<void>;
    readonly isSkycotCreatedFolder: (realPath: string) => Effect.Effect<boolean>;
    readonly rememberStart: (
      input: Omit<RememberedStart, "id" | "createdAt">,
    ) => Effect.Effect<void>;
    readonly rememberedStart: (input: {
      readonly projectRealPath: string;
      readonly exactCommand: string;
    }) => Effect.Effect<RememberedStart | null>;
    readonly rememberedStarts: Effect.Effect<ReadonlyArray<RememberedStart>>;
    readonly stopRememberedStartById: (id: string) => Effect.Effect<void>;
  }
>()("t3/skycot/SkycotProjectMemory") {}

const makeAt = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* Semaphore.make(1);
    const read = fs.readFileString(filePath).pipe(
      Effect.map((raw) => decode(raw)),
      Effect.map((result) => (result._tag === "Some" ? result.value : EMPTY)),
      Effect.orElseSucceed(() => EMPTY),
    );
    const write = Effect.fn("SkycotProjectMemory.write")(function* (file: MemoryFile) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encode(file)}\n`, { mode: 0o600 });
      yield* fs.rename(temp, filePath);
    });
    const recordCreatedFolder: SkycotProjectMemory["Service"]["recordCreatedFolder"] = (input) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const realPath = yield* fs.realPath(input.path).pipe(Effect.orElseSucceed(() => null));
          if (realPath === null) return;
          const current = yield* read;
          const createdFolders = current.createdFolders.filter(
            (entry) => entry.realPath !== realPath,
          );
          createdFolders.push({
            realPath,
            createdBy: "skycot",
            ...(input.childId ? { childId: input.childId } : {}),
            createdAt: yield* Clock.currentTimeMillis,
          });
          yield* write({
            ...current,
            createdFolders: createdFolders.slice(-MAX_CREATED_FOLDERS),
          }).pipe(
            Effect.ignoreCause({ log: true, message: "Could not record a SKYCOT-created folder." }),
          );
        }),
      );
    const isSkycotCreatedFolder: SkycotProjectMemory["Service"]["isSkycotCreatedFolder"] = (
      candidate,
    ) =>
      Effect.gen(function* () {
        const realPath = yield* fs.realPath(candidate).pipe(Effect.orElseSucceed(() => null));
        return (
          realPath !== null &&
          (yield* read).createdFolders.some((entry) => entry.realPath === realPath)
        );
      });
    const rememberStart: SkycotProjectMemory["Service"]["rememberStart"] = (input) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const realPath = yield* fs
            .realPath(input.projectRealPath)
            .pipe(Effect.orElseSucceed(() => null));
          if (realPath === null) return;
          const current = yield* read;
          const rememberedStarts = current.rememberedStarts.filter(
            (entry) => entry.projectRealPath !== realPath,
          );
          rememberedStarts.push({
            ...input,
            id: NodeCrypto.createHash("sha256")
              .update(`${realPath}\u0000${input.exactCommand}`)
              .digest("hex")
              .slice(0, 24),
            projectRealPath: realPath,
            createdAt: yield* Clock.currentTimeMillis,
          });
          yield* write({
            ...current,
            rememberedStarts: rememberedStarts.slice(-MAX_REMEMBERED_STARTS),
          }).pipe(
            Effect.ignoreCause({
              log: true,
              message: "Could not remember the approved preview command.",
            }),
          );
        }),
      );
    const rememberedStart: SkycotProjectMemory["Service"]["rememberedStart"] = (input) =>
      Effect.gen(function* () {
        const realPath = yield* fs
          .realPath(input.projectRealPath)
          .pipe(Effect.orElseSucceed(() => null));
        if (realPath === null) return null;
        return (
          (yield* read).rememberedStarts.find(
            (entry) =>
              entry.projectRealPath === realPath && entry.exactCommand === input.exactCommand,
          ) ?? null
        );
      });
    const rememberedStarts = read.pipe(Effect.map((file) => file.rememberedStarts));
    const stopRememberedStartById: SkycotProjectMemory["Service"]["stopRememberedStartById"] = (
      id,
    ) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* read;
          yield* write({
            ...current,
            rememberedStarts: current.rememberedStarts.filter((entry) => entry.id !== id),
          }).pipe(
            Effect.ignoreCause({
              log: true,
              message: "Could not stop remembering the preview command.",
            }),
          );
        }),
      );
    return SkycotProjectMemory.of({
      recordCreatedFolder,
      isSkycotCreatedFolder,
      rememberStart,
      rememberedStart,
      rememberedStarts,
      stopRememberedStartById,
    });
  });

export const layerAt = (filePath: string) => Layer.effect(SkycotProjectMemory, makeAt(filePath));
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, PROJECT_MEMORY_FILE));
  }),
);
