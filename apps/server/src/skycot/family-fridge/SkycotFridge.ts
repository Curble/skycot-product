// The family fridge, engine side: lists what each child made and keeps the pins in
// `<T3 home>/userdata/skycot-fridge.json`, on this Mac. Open to everyone who can use SKYCOT
// (children see their own and their siblings' work, and pinning is free); works with the
// Family profile off too, as one shelf of everything made here.

// Random temp-file names; no Effect counterpart is needed for one call.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type { ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import { pageOf } from "../family-recap/recap.ts";
import { loadThread } from "../family-recap/threads.ts";
import { fridgeItems, type FridgeItem } from "./fridge.ts";
import { MAX_ASSET_BYTES, selfContainedPage } from "./thumbnail.ts";

export const FRIDGE_FILE_NAME = "skycot-fridge.json";
const PINS_KEEP = 500;

const FridgeFile = Schema.Struct({
  version: Schema.Literal(1),
  /** Thread id → when it was pinned (epoch ms). */
  pins: Schema.Record(Schema.String, Schema.Number),
});
type FridgeFile = typeof FridgeFile.Type;

const decodeFridge = Schema.decodeUnknownOption(Schema.fromJsonString(FridgeFile));
const encodeFridge = Schema.encodeEffect(Schema.fromJsonString(FridgeFile));

export class SkycotFridge extends Context.Service<
  SkycotFridge,
  {
    readonly list: Effect.Effect<ReadonlyArray<FridgeItem>>;
    /** Pins a magnet, or takes it down. Never touches the page itself. */
    readonly pin: (input: {
      readonly threadId: string;
      readonly pinned: boolean;
    }) => Effect.Effect<ReadonlyArray<FridgeItem>>;
    /**
     * A page this conversation made, with its own stylesheets, pictures and fonts inside it, for
     * the thumbnail frame (./thumbnail.ts). Null when the conversation never made that page.
     */
    readonly page: (input: {
      readonly threadId: string;
      readonly page: string;
    }) => Effect.Effect<string | null>;
  }
>()("t3/skycot/family-fridge/SkycotFridge") {}

const makeAt = Effect.fn("SkycotFridge.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const limits = yield* Effect.serviceOption(SkycotFamilyLimits.SkycotFamilyLimits);
  const lock = yield* Semaphore.make(1);

  const readPins = fs.readFileString(filePath).pipe(
    Effect.map((raw) => decodeFridge(raw)),
    Effect.map((decoded) => (decoded._tag === "Some" ? decoded.value.pins : {})),
    Effect.orElseSucceed((): FridgeFile["pins"] => ({})),
  );

  const writePins = Effect.fn("SkycotFridge.save")(
    function* (pins: FridgeFile["pins"]) {
      yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${NodeCrypto.randomBytes(6).toString("hex")}.tmp`;
      yield* fs.writeFileString(temp, `${yield* encodeFridge({ version: 1, pins })}\n`, {
        mode: 0o600,
      });
      yield* fs.rename(temp, filePath);
    },
    Effect.catchCause((cause) => Effect.logWarning("Could not save the fridge.", { cause })),
  );

  const owners = Effect.gen(function* () {
    if (limits._tag === "None") return {};
    const snapshot = yield* limits.value.snapshot;
    return snapshot?.activity.threads ?? {};
  });

  const listWith = Effect.fnUntraced(function* (pins: FridgeFile["pins"]) {
    const shell = yield* projections.getShellSnapshot().pipe(Effect.orElseSucceed(() => null));
    if (shell === null) return [];
    const threads = [];
    for (const thread of [...shell.threads, ...shell.archivedThreads]) {
      if (thread.deletedAt !== null) continue;
      const loaded = yield* loadThread(projections, projects, thread.id as ThreadId, {
        messages: false,
      });
      if (loaded !== null) threads.push(loaded);
    }
    return fridgeItems(threads, yield* owners, pins);
  });

  const list: SkycotFridge["Service"]["list"] = Effect.suspend(() =>
    readPins.pipe(Effect.flatMap(listWith)),
  ).pipe(Effect.withSpan("SkycotFridge.list"));

  const pin: SkycotFridge["Service"]["pin"] = Effect.fn("SkycotFridge.pin")(function* (input) {
    const pins = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const current = { ...(yield* readPins) };
        if (input.pinned) {
          current[input.threadId] = yield* Clock.currentTimeMillis;
        } else {
          delete current[input.threadId];
        }
        const kept = Object.fromEntries(
          Object.entries(current)
            .sort((a, b) => b[1] - a[1])
            .slice(0, PINS_KEEP),
        );
        yield* writePins(kept);
        return kept;
      }),
    );
    return yield* listWith(pins);
  });

  const page: SkycotFridge["Service"]["page"] = Effect.fn("SkycotFridge.page")(function* (input) {
    const thread = yield* loadThread(projections, projects, input.threadId as ThreadId, {
      messages: false,
    });
    if (thread === null || thread.deleted || thread.cwd === null) return null;
    const pages = new Set(thread.checkpoints.map((checkpoint) => pageOf(checkpoint.files)));
    if (!pages.has(input.page)) return null;
    const root = yield* fs.realPath(thread.cwd).pipe(Effect.orElseSucceed(() => null));
    if (root === null) return null;
    const relativePage = path.isAbsolute(input.page)
      ? path.relative(root, input.page).split(path.sep).join("/")
      : input.page;
    return yield* selfContainedPage(relativePage, (relativePath) =>
      Effect.gen(function* () {
        const target = yield* fs.realPath(path.join(root, relativePath));
        // Links and `..` that leave the project are refused, like the project's own file reads.
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
        const info = yield* fs.stat(target);
        if (info.type !== "File" || Number(info.size) > MAX_ASSET_BYTES) return null;
        return yield* fs.readFile(target);
      }).pipe(Effect.orElseSucceed(() => null)),
    );
  });

  return SkycotFridge.of({ list, pin, page });
});

/** For tests and tools: a fridge file at an explicit path. */
export const layerAt = (filePath: string) => Layer.effect(SkycotFridge, makeAt(filePath));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, FRIDGE_FILE_NAME));
  }),
);
