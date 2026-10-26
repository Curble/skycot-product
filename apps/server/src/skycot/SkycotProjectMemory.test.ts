// nondev-seam: skycot-project-memory-test
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as SkycotProjectMemory from "./SkycotProjectMemory.ts";

it.layer(NodeServices.layer)("SkycotProjectMemory", (it) => {
  it.effect(
    "records only engine-written folders and resolves symlinks to the recorded folder",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-project-memory-" });
        const folder = path.join(dir, "created");
        const alias = path.join(dir, "alias");
        yield* fs.makeDirectory(folder);
        yield* fs.symlink(folder, alias);
        const memory = yield* Effect.gen(function* () {
          return yield* SkycotProjectMemory.SkycotProjectMemory;
        }).pipe(
          Effect.provide(
            SkycotProjectMemory.layerAt(
              path.join(dir, SkycotProjectMemory.PROJECT_MEMORY_FILE),
            ).pipe(Layer.provide(NodeServices.layer)),
          ),
        );
        assert.isFalse(yield* memory.isSkycotCreatedFolder(folder));
        yield* memory.recordCreatedFolder({ path: folder, childId: "child-a" });
        assert.isTrue(yield* memory.isSkycotCreatedFolder(folder));
        assert.isTrue(yield* memory.isSkycotCreatedFolder(alias));
        const saved = yield* fs.readFileString(
          path.join(dir, SkycotProjectMemory.PROJECT_MEMORY_FILE),
        );
        assert.include(saved, '"createdBy":"skycot"');
        assert.include(saved, '"childId":"child-a"');
        assert.isFalse(yield* memory.isSkycotCreatedFolder(path.join(dir, "unknown")));
        yield* memory.rememberStart({
          projectRealPath: folder,
          exactCommand: "npm run dev",
          approvedBy: "grown-up-1",
          how: "parent-code",
        });
        assert.isNotNull(
          yield* memory.rememberedStart({ projectRealPath: alias, exactCommand: "npm run dev" }),
        );
        assert.isNull(
          yield* memory.rememberedStart({ projectRealPath: folder, exactCommand: "npm run start" }),
        );
        yield* memory.rememberStart({
          projectRealPath: folder,
          exactCommand: "npm run start",
          approvedBy: "grown-up-1",
          how: "grown-up-session",
        });
        assert.isNull(
          yield* memory.rememberedStart({ projectRealPath: folder, exactCommand: "npm run dev" }),
        );
        const remembered = yield* memory.rememberedStarts;
        assert.equal(remembered.length, 1);
        yield* memory.stopRememberedStartById(remembered[0]!.id);
        assert.equal((yield* memory.rememberedStarts).length, 0);
      }).pipe(Effect.scoped),
  );
});
