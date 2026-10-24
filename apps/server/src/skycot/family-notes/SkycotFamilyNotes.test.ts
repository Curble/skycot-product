import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as SkycotFamilyNotes from "./SkycotFamilyNotes.ts";

it.layer(NodeServices.layer)("SkycotFamilyNotes", (it) => {
  it.effect("persists notes, keeps child status scoped, and resolves only open notes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-notes-" });
      const notesLayer = SkycotFamilyNotes.layerAt(path.join(dir, SkycotFamilyNotes.FILE_NAME));
      const filePath = path.join(dir, SkycotFamilyNotes.FILE_NAME);
      const operation = Effect.gen(function* () {
        const notes = yield* SkycotFamilyNotes.SkycotFamilyNotes;
        const shown = yield* notes.create({
          kind: "shown",
          childId: "ava",
          threadId: "thread-a",
          title: "Maze",
        });
        const more = yield* notes.create({ kind: "more-time", childId: "ava" });
        yield* notes.create({ kind: "more-time", childId: "leo" });
        // Tapping again reuses the open note instead of piling up (and re-buzzing a phone).
        assert.equal((yield* notes.create({ kind: "more-time", childId: "ava" })).id, more.id);
        assert.equal(
          (yield* notes.create({
            kind: "shown",
            childId: "ava",
            threadId: "thread-a",
            title: "Maze",
          })).id,
          shown.id,
        );
        assert.equal((yield* notes.own("ava")).length, 2);
        assert.equal((yield* notes.own("ava"))[0]?.id, shown.id);
        assert.equal((yield* notes.open).length, 3);
        assert.isTrue(yield* notes.seen(shown.id));
        const answered = yield* notes.answer({ id: more.id, minutes: 15, by: "Mum Smith" });
        assert.equal(answered?.status, "done");
        assert.equal(answered?.kind === "more-time" ? answered.answer?.by : null, "Mum");
        assert.isNull(yield* notes.answer({ id: more.id, minutes: 30, by: "Dad" }));
        assert.equal((yield* notes.open).length, 1);
        assert.equal((yield* notes.own("ava")).length, 2);
      }).pipe(Effect.provide(notesLayer));
      yield* operation;
      yield* Effect.gen(function* () {
        const notes = yield* SkycotFamilyNotes.SkycotFamilyNotes;
        assert.equal((yield* notes.own("ava")).length, 2);
      }).pipe(Effect.provide(SkycotFamilyNotes.layerAt(filePath)));
    }).pipe(Effect.scoped),
  );
});
