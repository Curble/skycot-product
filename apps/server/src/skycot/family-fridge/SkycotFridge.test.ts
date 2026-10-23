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
      yield* fs.writeFileString(path.join(dir, "secret.css"), "body { content: 'secret' }");
      // A link that leaves the project is refused even though its name looks like the project's.
      yield* fs.symlink(path.join(dir, "secret.css"), path.join(root, "leak.css"));
      const live = records("live", "Space game", false);
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadRecords: (() => Effect.succeed(live as never)) as never,
      });
      const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () => Effect.succeed(Option.some({ title: "Games", workspaceRoot: root } as never)),
      });
      const [made, other] = yield* Effect.gen(function* () {
        const fridge = yield* SkycotFridge.SkycotFridge;
        return [
          yield* fridge.page({ threadId: "live", page: "index.html" }),
          yield* fridge.page({ threadId: "live", page: "style.css" }),
        ] as const;
      }).pipe(
        Effect.provide(
          SkycotFridge.layerAt(path.join(dir, SkycotFridge.FRIDGE_FILE_NAME)).pipe(
            Layer.provide(Layer.merge(projections, projects)),
          ),
        ),
      );
      assert.include(made ?? "", "<style>body { color: hotpink }</style>");
      assert.notInclude(made ?? "", "secret");
      assert.notInclude(made ?? "", "<link");
      assert.isNull(other);
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
});
