import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { HOUR, NOW } from "./fixtures.test-helpers.ts";
import {
  LIMITS_FILE_NAME,
  LIMITS_KEEP,
  afterCompletedTurn,
  keptLimits,
  makeLearnedLimitStore,
} from "./learnedLimits.ts";

const entry = (
  model: string | null,
  until: number,
  learnedAt = NOW,
  instanceId = "claudeAgent",
) => ({
  instanceId,
  model,
  until,
  learnedAt,
});

describe("what is kept", () => {
  it("drops passed and implausible reset times, keeps the later reset per model", () => {
    const kept = keptLimits(
      [
        entry("claude-fable-5-1", NOW - 1),
        entry("claude-opus-5-5", NOW + 30 * 24 * HOUR),
        entry("claude-sonnet-5-5", NOW + 2 * HOUR),
        entry("claude-sonnet-5-5", NOW + HOUR),
        entry(null, NOW + 3 * HOUR),
        entry("claude-fable-5-1", NOW + 60 * HOUR, NOW, ""),
      ],
      NOW,
    );
    assert.deepStrictEqual(
      kept.map((limit) => [limit.model, limit.until]),
      [
        ["claude-sonnet-5-5", NOW + 2 * HOUR],
        [null, NOW + 3 * HOUR],
      ],
    );
  });

  it("is capped, newest lessons kept", () => {
    const many = Array.from({ length: LIMITS_KEEP + 25 }, (_, index) =>
      entry(`model-${index}`, NOW + HOUR),
    );
    const kept = keptLimits(many, NOW);
    assert.lengthOf(kept, LIMITS_KEEP);
    assert.equal(kept.at(-1)?.model, `model-${LIMITS_KEEP + 24}`);
  });

  it("a turn that completed on a model undoes the lessons from before it started", () => {
    const lessons = [
      entry("claude-fable-5-1", NOW + 60 * HOUR, NOW - HOUR),
      entry(null, NOW + 2 * HOUR, NOW - HOUR),
      entry("claude-opus-5-5", NOW + 60 * HOUR, NOW - HOUR),
      entry("claude-fable-5-1", NOW + 60 * HOUR, NOW - HOUR, "claudeWork"),
    ];
    const left = afterCompletedTurn(
      lessons,
      { instanceId: "claudeAgent", model: "fable" },
      NOW,
      (learned, ran) => learned === "claude-fable-5-1" && ran === "fable",
    );
    assert.deepStrictEqual(
      left.map((limit) => [limit.instanceId, limit.model]),
      [
        ["claudeAgent", "claude-opus-5-5"],
        ["claudeWork", "claude-fable-5-1"],
      ],
    );
    // A turn already running when the lesson was learned proves nothing.
    assert.lengthOf(
      afterCompletedTurn(
        lessons,
        { instanceId: "claudeAgent", model: "claude-fable-5-1" },
        NOW - 2 * HOUR,
      ),
      4,
    );
  });
});

describe("the file", () => {
  const inTemp = <A, E>(
    use: (filePath: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  ) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-learned-limits-" });
      return yield* use(path.join(dir, LIMITS_FILE_NAME));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

  it.effect("survives a new store (a restart), owner-only, with no temp file left", () =>
    inTemp((filePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const first = yield* makeLearnedLimitStore(filePath);
        yield* first.learn(
          [{ instanceId: "claudeAgent", model: "claude-fable-5-1", until: NOW + 60 * HOUR }],
          NOW,
        );
        const again = yield* makeLearnedLimitStore(filePath);
        assert.deepStrictEqual(yield* again.current(NOW + HOUR), [
          { instanceId: "claudeAgent", model: "claude-fable-5-1", until: NOW + 60 * HOUR },
        ]);
        assert.deepStrictEqual(yield* again.current(NOW + 61 * HOUR), []);
        assert.equal(Number((yield* fs.stat(filePath)).mode) & 0o777, 0o600);
        assert.deepStrictEqual(yield* fs.readDirectory(path.dirname(filePath)), [LIMITS_FILE_NAME]);

        // A completed turn on Fable clears it, on disk too.
        yield* again.forgetFor(
          { instanceId: "claudeAgent", model: "claude-fable-5-1" },
          NOW + HOUR,
        );
        assert.deepStrictEqual(
          yield* (yield* makeLearnedLimitStore(filePath)).current(NOW + HOUR),
          [],
        );
      }),
    ),
  );

  it.effect("missing or unreadable is empty", () =>
    inTemp((filePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.deepStrictEqual(yield* (yield* makeLearnedLimitStore(filePath)).current(NOW), []);
        yield* fs.writeFileString(filePath, "{not json");
        assert.deepStrictEqual(yield* (yield* makeLearnedLimitStore(filePath)).current(NOW), []);
      }),
    ),
  );
});
