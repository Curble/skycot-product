// Grown-ups as people: a profile from before them reads with one (the person who set it up),
// the same one on every read, and children and the code stay exactly as they were.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as SkycotFamily from "../SkycotFamily.ts";

const CODE = "482913";

it.layer(NodeServices.layer)("grown-ups as people", (it) => {
  it.effect("an existing profile gains its first grown-up, safely", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-people-" });
      const filePath = path.join(dir, SkycotFamily.FAMILY_FILE_NAME);
      const family = yield* Effect.provide(
        SkycotFamily.SkycotFamily,
        SkycotFamily.layerAt(filePath),
      );
      const before = yield* family.enable({ code: CODE, childName: "Ava" });
      yield* family.addChild({ name: "Leo" });
      // Write the file as beta 2 would have: no grown-ups, no devices.
      const raw = JSON.parse(yield* fs.readFileString(filePath)) as Record<string, unknown>;
      delete raw["grownUps"];
      delete raw["devices"];
      yield* fs.writeFileString(filePath, JSON.stringify(raw));
      const migrated = yield* family.status;
      assert.equal(migrated.grownUps.length, 1);
      assert.isNull(migrated.grownUps[0]!.name);
      const firstId = migrated.grownUps[0]!.id;
      assert.equal((yield* family.status).grownUps[0]!.id, firstId);
      assert.deepEqual(
        migrated.children.map((child) => child.name),
        ["Ava", "Leo"],
      );
      assert.equal(migrated.children[0]!.id, before.children[0]!.id);
      assert.deepEqual(migrated.devices, []);
      // The code still works, and the next change writes the grown-up down with the same id.
      yield* family.checkCode({ code: CODE });
      yield* family.updateGrownUp({ personId: firstId, patch: { name: "  Mum " } });
      const saved = JSON.parse(yield* fs.readFileString(filePath)) as {
        readonly version: number;
        readonly grownUps: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      };
      assert.equal(saved.version, SkycotFamily.FAMILY_FILE_VERSION);
      assert.deepEqual(
        saved.grownUps.map((person) => [person.id, person.name]),
        [[firstId, "Mum"]],
      );
      // A second grown-up; the last one can never be removed.
      const dad = yield* family.addGrownUp({ name: "Dad" });
      yield* family.removeGrownUp({ personId: dad.personId });
      const last = yield* Effect.flip(family.removeGrownUp({ personId: firstId }));
      assert.equal(last.reason, "invalid-request");
    }).pipe(Effect.scoped),
  );

  it.effect("a version 1 profile (one child) also reads with its grown-up", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-people-v1-" });
      const filePath = path.join(dir, SkycotFamily.FAMILY_FILE_NAME);
      yield* fs.writeFileString(
        filePath,
        JSON.stringify({
          version: 1,
          enabled: true,
          childName: "Ava",
          codeHash: "00",
          salt: "abc",
          createdAt: "2026-10-01T00:00:00.000Z",
          failedAttempts: 0,
          lockedUntil: null,
          tokenSecret: "s",
          grants: [],
        }),
      );
      const family = yield* Effect.provide(
        SkycotFamily.SkycotFamily,
        SkycotFamily.layerAt(filePath),
      );
      const status = yield* family.status;
      assert.equal(status.children.length, 1);
      assert.equal(status.grownUps.length, 1);
    }).pipe(Effect.scoped),
  );
});
