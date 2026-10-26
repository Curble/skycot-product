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
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import { pageOf } from "../family-recap/recap.ts";
import { loadThread } from "../family-recap/threads.ts";
import * as SkycotQuestions from "../questions/SkycotQuestions.ts";
import { fridgeItems, type FridgeItem } from "./fridge.ts";
import { MAX_ASSET_BYTES, selfContainedPage } from "./thumbnail.ts";
// nondev-seam: skycot-playable-copy
import { MAX_PLAYABLE_FILE_BYTES, playablePage } from "./playable.ts";

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
    // nondev-seam: skycot-playable-copy
    readonly playable: (input: {
      readonly threadId: string;
      readonly page: string;
      readonly sitesForPage: (realPath: string) => Effect.Effect<ReadonlyArray<string> | null>;
    }) => Effect.Effect<{
      readonly html: string | null;
      readonly reason: "too-big" | "unpackable-module" | "remote-script" | null;
      readonly needs: {
        readonly scripts: ReadonlyArray<string>;
        readonly other: ReadonlyArray<string>;
      };
      readonly page: string | null;
    }>;
    /** Canonical existing page path, only when it resolves inside this thread's project. */
    readonly pagePath: (input: {
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
  // Optional so the tests and tools that build this alone still work; the server provides it.
  const diffs = Option.getOrUndefined(
    yield* Effect.serviceOption(CheckpointDiffQuery.CheckpointDiffQuery),
  );
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;
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
        ...(diffs === undefined ? {} : { diffs }),
        questionsRoot,
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

  // nondev-seam: skycot-playable-copy
  const playable: SkycotFridge["Service"]["playable"] = Effect.fn("SkycotFridge.playable")(
    function* (input) {
      const thread = yield* loadThread(projections, projects, input.threadId as ThreadId, {
        messages: false,
      });
      if (
        thread === null ||
        thread.deleted ||
        thread.cwd === null ||
        !/\.html?$/iu.test(input.page)
      )
        return { html: null, reason: null, needs: { scripts: [], other: [] }, page: null } as const;
      if (
        !new Set(thread.checkpoints.map((checkpoint) => pageOf(checkpoint.files))).has(input.page)
      )
        return { html: null, reason: null, needs: { scripts: [], other: [] }, page: null } as const;
      const root = yield* fs.realPath(thread.cwd).pipe(Effect.orElseSucceed(() => null));
      if (root === null)
        return { html: null, reason: null, needs: { scripts: [], other: [] }, page: null } as const;
      const relativePage = path.isAbsolute(input.page)
        ? path.relative(root, input.page).split(path.sep).join("/")
        : input.page;
      if (
        !relativePage ||
        relativePage.split(/[\\/]/u).some((part) => !part || part === ".." || part.startsWith("."))
      )
        return { html: null, reason: null, needs: { scripts: [], other: [] }, page: null } as const;
      const realPage = yield* fs
        .realPath(path.join(root, relativePage))
        .pipe(Effect.orElseSucceed(() => null));
      if (realPage === null || (realPage !== root && !realPage.startsWith(`${root}${path.sep}`)))
        return { html: null, reason: null, needs: { scripts: [], other: [] }, page: null } as const;
      const sites = (yield* input.sitesForPage(realPage)) ?? [];
      const result = yield* playablePage(
        relativePage,
        (relativePath) =>
          Effect.gen(function* () {
            if (
              relativePath
                .split(/[\\/]/u)
                .some((part) => !part || part === ".." || part.startsWith("."))
            )
              return null;
            const target = yield* fs.realPath(path.join(root, relativePath));
            if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
            const resolvedParts = path.relative(root, target).split(path.sep);
            if (
              resolvedParts.some(
                (part) =>
                  !part ||
                  part.startsWith(".") ||
                  /secret|password|credential|\.env|id_rsa|id_ed25519|id_ecdsa|private[_-]?key|\.(?:pem|key)$/iu.test(
                    part,
                  ),
              )
            )
              return null;
            const info = yield* fs.stat(target);
            if (info.type !== "File" || Number(info.size) > MAX_PLAYABLE_FILE_BYTES) return null;
            return yield* fs.readFile(target);
          }).pipe(Effect.orElseSucceed(() => null)),
        sites,
      );
      return { ...result, page: realPage };
    },
  );

  const pagePath: SkycotFridge["Service"]["pagePath"] = Effect.fn("SkycotFridge.pagePath")(
    function* (input) {
      const thread = yield* loadThread(projections, projects, input.threadId as ThreadId, {
        messages: false,
      });
      if (
        thread === null ||
        thread.deleted ||
        thread.cwd === null ||
        !/\.html?$/iu.test(input.page)
      )
        return null;
      const pages = new Set(
        thread.checkpoints
          .map((checkpoint) => pageOf(checkpoint.files))
          .filter((page) => page !== null),
      );
      const root = yield* fs.realPath(thread.cwd).pipe(Effect.orElseSucceed(() => null));
      if (root === null) return null;
      const relative = path.isAbsolute(input.page)
        ? path.relative(root, input.page).split(path.sep).join("/")
        : input.page;
      if (
        !relative ||
        relative.split(/[\\/]/u).some((part) => !part || part === ".." || part.startsWith("."))
      )
        return null;
      const real = yield* fs
        .realPath(path.join(root, relative))
        .pipe(Effect.orElseSucceed(() => null));
      if (real === null || (real !== root && !real.startsWith(`${root}${path.sep}`))) return null;
      let belongsToThread = pages.has(relative);
      if (!belongsToThread && path.isAbsolute(input.page)) {
        for (const checkpointPage of pages) {
          if (
            checkpointPage
              .split(/[\\/]/u)
              .some((part) => !part || part === ".." || part.startsWith("."))
          )
            continue;
          const checkpointReal = yield* fs
            .realPath(path.join(root, checkpointPage))
            .pipe(Effect.orElseSucceed(() => null));
          if (checkpointReal === real) {
            belongsToThread = true;
            break;
          }
        }
      }
      if (!belongsToThread) return null;
      const info = yield* fs.stat(real).pipe(Effect.orElseSucceed(() => null));
      return info?.type === "File" ? real : null;
    },
  );

  return SkycotFridge.of({ list, pin, page, playable, pagePath });
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
