// nondev-seam: skycot-playable-copy-test
// nondev-seam: skycot-fridge-card-store-test
// nondev-seam: skycot-fridge-thumbnail-cache-test
// nondev-seam: skycot-iphone-q50-fridge-title-engine-test
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SkycotFridge from "./SkycotFridge.ts";

const AT = DateTime.makeUnsafe("2026-10-22T09:00:00.000Z");
const ROOT = "/Users/kid/games";

/** A conversation that made a page, as the projections hold it. */
const records = (id: string, title: string, archived: boolean) => ({
  thread: {
    id,
    projectId: "project:games",
    title,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: archived ? AT : null,
    deletedAt: null,
    worktreePath: null,
  },
  checkpointScopes: [{ id: `scope:${id}`, kind: "root_run" }],
  checkpoints: [
    {
      id: `checkpoint:${id}`,
      runId: `run:${id}`,
      scopeId: `scope:${id}`,
      capturedAt: AT,
      files: [{ path: "index.html", kind: "added", additions: 10, deletions: 0 }],
    },
  ],
  runs: [{ id: `run:${id}`, status: "completed" }],
});

// Putting a conversation away is the engine's archive, not a delete: its page stays on the
// fridge (and in the recap and the sticker counts, which read the same records by id).
it.layer(NodeServices.layer)("SkycotFridge", (it) => {
  it.effect("refreshes a magnet from its current page title and content", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-title-" });
      const root = path.join(dir, "games");
      yield* fs.makeDirectory(root, { recursive: true });
      const record = records("live", "Hello bounce game", false);
      yield* fs.writeFileString(path.join(root, "index.html"), "<title>Bounce</title>");
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({ threads: [record.thread], archivedThreads: [] } as never),
        getThreadRecords: (() => Effect.succeed(record as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: root } as never)),
      });
      const [first, second] = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        const first = (yield* fridge.list)[0]!;
        yield* fs.writeFileString(path.join(root, "index.html"), "<h1>Nana's birthday card</h1>");
        const second = (yield* fridge.list)[0]!;
        return [first, second] as const;
      }).pipe(
        Effect.provide(
          SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
            Layer.provide(Layer.merge(projections, projects)),
          ),
        ),
      );
      assert.equal(first.title, "Bounce");
      assert.equal(second.title, "Nana's birthday card");
      assert.notEqual(second.contentHash, first.contentHash);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a put-away conversation's magnet, under its new name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-" });
      const byId = {
        live: records("live", "Space game", false),
        old: records("old", "Mia's dinosaur game", true),
      } as const;
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({
            threads: [byId.live.thread],
            archivedThreads: [byId.old.thread],
          } as never),
        getThreadRecords: ((threadId: keyof typeof byId) =>
          Effect.succeed(byId[threadId] as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: ROOT } as never)),
      });
      const items = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        return yield* fridge.list;
      }).pipe(
        Effect.provide(
          SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
            Layer.provide(Layer.merge(projections, projects)),
          ),
        ),
      );
      assert.deepEqual(items.map((item) => [item.threadId, item.title]).sort(), [
        ["live", "Space game"],
        ["old", "Mia's dinosaur game"],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("sends a made page with its own stylesheet inside, and only pages it made", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-page-" });
      const root = path.join(dir, "games");
      yield* fs.makeDirectory(root, { recursive: true });
      yield* fs.writeFileString(
        path.join(root, "index.html"),
        '<html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="leak.css"></head><body>Space</body></html>',
      );
      yield* fs.writeFileString(path.join(root, "style.css"), "body { color: hotpink }");
      yield* fs.writeFileString(path.join(root, "unmade.html"), "<p>not checkpointed</p>");
      yield* fs.writeFileString(path.join(dir, "secret.css"), "body { content: 'secret' }");
      // A link that leaves the project is refused even though its name looks like the project's.
      yield* fs.symlink(path.join(dir, "secret.css"), path.join(root, "leak.css"));
      const live = records("live", "Space game", false);
      let revision = 0;
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadRecords: (() =>
          Effect.succeed({
            ...live,
            checkpoints: live.checkpoints.map((checkpoint) => ({
              ...checkpoint,
              id: `checkpoint:${revision}`,
            })),
          } as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: root } as never)),
      });
      const [made, cached, assetChanged, changed, other, unmade] = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        const first = yield* fridge.page({ threadId: "live", page: "index.html" });
        yield* fs.remove(path.join(root, "style.css"));
        const second = yield* fridge.page({ threadId: "live", page: "index.html" });
        yield* fs.writeFileString(path.join(root, "style.css"), "body { color: purple }");
        revision += 1;
        const updatedAsset = yield* fridge.page({ threadId: "live", page: "index.html" });
        yield* fs.writeFileString(
          path.join(root, "index.html"),
          '<html><head><link rel="stylesheet" href="style.css"></head><body>Moon</body></html>',
        );
        return [
          first,
          second,
          updatedAsset,
          yield* fridge.page({ threadId: "live", page: "index.html" }),
          yield* fridge.page({ threadId: "live", page: "style.css" }),
          yield* fridge.playable({
            threadId: "live",
            page: "unmade.html",
            sitesForPage: () => Effect.succeed([]),
          }),
        ] as const;
      }).pipe(
        Effect.provide(
          SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
            Layer.provide(Layer.merge(projections, projects)),
          ),
        ),
      );
      assert.include(made ?? "", "<style>body { color: hotpink }</style>");
      assert.equal(cached, made);
      assert.include(assetChanged ?? "", "color: purple");
      assert.include(changed ?? "", "Moon");
      assert.notInclude(changed ?? "", "Space");
      const cache = yield* fs.readFileString(path.join(dir, "skycot-fridge-thumbnails.json"));
      assert.include(cache, "Moon");
      assert.notInclude(made ?? "", "secret");
      assert.notInclude(made ?? "", "<link");
      assert.isNull(other);
      assert.isNull(unmade.html);
    }).pipe(Effect.scoped),
  );

  // The allowance ran out while the card was being written; "Please try again" finished it.
  // The failed turn saved no checkpoint and the retry's own list is empty, but the page is
  // there, so it still goes on the fridge.
  it.effect("puts a page made across a failed turn and its retry on the fridge", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-" });
      const point = (ordinal: number, runId: string | null) => ({
        id: `checkpoint:${ordinal}`,
        runId,
        scopeId: "scope:card",
        ordinalWithinScope: ordinal,
        appRunOrdinal: runId === null ? null : ordinal,
        capturedAt: AT,
        files: [],
      });
      const card = {
        thread: { ...records("card", "Create Nan's 80th Birthday Card", false).thread },
        checkpointScopes: [{ id: "scope:card", kind: "root_run" }],
        checkpoints: [point(0, null), point(1, null), point(2, "run:2")],
        runs: [
          { id: "run:1", status: "failed" },
          { id: "run:2", status: "completed" },
        ],
      };
      const asked: Array<[number, number]> = [];
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({ threads: [card.thread], archivedThreads: [] } as never),
        getThreadRecords: (() => Effect.succeed(card as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: ROOT } as never)),
      });
      const diffs = Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
        getTurnDiff: ((input: { fromTurnCount: number; toTurnCount: number }) => {
          asked.push([input.fromTurnCount, input.toTurnCount]);
          return Effect.succeed({
            ...input,
            diff: "diff --git a/birthday-card.html b/birthday-card.html\nnew file mode 100644\n+<h1>Hi</h1>",
          } as never);
        }) as never,
      });
      const items = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        return yield* fridge.list;
      }).pipe(
        Effect.provide(
          SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
            Layer.provide(Layer.mergeAll(projections, projects, diffs)),
          ),
        ),
      );
      assert.deepEqual(
        items.map((item) => [item.threadId, item.page]),
        [["card", "birthday-card.html"]],
      );
      assert.deepEqual(asked, [[0, 2]]);
    }).pipe(Effect.scoped),
  );

  it.effect("saves each card as a file, serves it by hash, and a changed page gets a new one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-cards-" });
      const root = path.join(dir, "games");
      yield* fs.makeDirectory(root, { recursive: true });
      const record = records("live", "Hello bounce game", false);
      yield* fs.writeFileString(path.join(root, "index.html"), "<title>Bounce</title>");
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({ threads: [record.thread], archivedThreads: [] } as never),
        getThreadRecords: (() => Effect.succeed(record as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: root } as never)),
      });
      const cardsDir = path.join(dir, "skycot-fridge-cards");
      const layer = SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
        Layer.provide(Layer.merge(projections, projects)),
      );
      const first = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        const item = (yield* fridge.list)[0]!;
        return { item, served: yield* fridge.card(item.cardHash!) };
      }).pipe(Effect.provide(layer));
      assert.deepEqual(yield* fs.readDirectory(cardsDir), [`${first.item.cardHash}.svg`]);
      assert.equal(first.served, first.item.thumbnailSvg);
      assert.include(first.item.thumbnailSvg!, "Bounce");

      yield* fs.writeFileString(path.join(root, "index.html"), "<title>Bounce 2</title>");
      const second = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        return (yield* fridge.list)[0]!;
      }).pipe(Effect.provide(layer));
      assert.notEqual(second.cardHash, first.item.cardHash);
      assert.lengthOf(yield* fs.readDirectory(cardsDir), 2);
    }).pipe(Effect.scoped),
  );

  // nondev-seam: skycot-fridge-picture-test
  it.effect("keeps a picture of the real page only for the page as it is now", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-fridge-picture-" });
      const root = path.join(dir, "games");
      yield* fs.makeDirectory(root, { recursive: true });
      const record = records("live", "Hello bounce game", false);
      yield* fs.writeFileString(path.join(root, "index.html"), "<title>Bounce</title>");
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: () =>
          Effect.succeed({ threads: [record.thread], archivedThreads: [] } as never),
        getThreadRecords: (() => Effect.succeed(record as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: root } as never)),
      });
      const layer = SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
        Layer.provide(Layer.merge(projections, projects)),
      );
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
      const result = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        const item = (yield* fridge.list)[0]!;
        const input = { threadId: "live", page: item.page, contentHash: item.contentHash!, png };
        const before = item.hasPicture;
        const stale = yield* fridge.storePicture({ ...input, contentHash: "old" });
        const gone = yield* fridge.storePicture({ ...input, threadId: "nobody" });
        const invalid = yield* fridge.storePicture({ ...input, png: new Uint8Array([1, 2, 3]) });
        const stored = yield* fridge.storePicture(input);
        const after = (yield* fridge.list)[0]!;
        return {
          before,
          stale,
          gone,
          invalid,
          stored,
          after: after.hasPicture,
          bytes: Array.from((yield* fridge.picture(after.cardHash!))!),
        };
      }).pipe(Effect.provide(layer));
      assert.isFalse(result.before);
      assert.equal(result.stale, "stale");
      assert.equal(result.gone, "gone");
      assert.equal(result.invalid, "invalid");
      assert.equal(result.stored, "stored");
      assert.isTrue(result.after);
      assert.deepEqual(result.bytes, Array.from(png));
    }).pipe(Effect.scoped),
  );
});
