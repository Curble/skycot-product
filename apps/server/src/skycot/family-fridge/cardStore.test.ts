// nondev-seam: skycot-fridge-card-store-test
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { cardHashOf, isCardHash, makeCardStore, MAX_CARD_FILES } from "./cardStore.ts";
import { fridgeSvgThumbnail } from "./fridge.ts";

it.layer(NodeServices.layer)("fridge card files", (it) => {
  it.effect("writes a card, reads it back, and writes a new file when the page changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "cards-" }), "cards");
      const store = yield* makeCardStore(dir);
      const first = cardHashOf("page-v1", "Game");
      const second = cardHashOf("page-v2", "Game");
      assert.notEqual(first, second);
      yield* store.write(first, "<svg>one</svg>");
      assert.equal(yield* store.read(first), "<svg>one</svg>");
      assert.isNull(yield* store.read(second));
      yield* store.write(second, "<svg>two</svg>");
      assert.sameMembers(yield* fs.readDirectory(dir), [`${first}.svg`, `${second}.svg`]);
    }).pipe(Effect.scoped),
  );

  it.effect("only touches names that are hashes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "cards-" }), "cards");
      const store = yield* makeCardStore(dir);
      assert.isFalse(isCardHash("../../secret"));
      yield* store.write("../../secret", "<svg/>");
      assert.isNull(yield* store.read("../../secret"));
      assert.isFalse(yield* fs.exists(dir));
    }).pipe(Effect.scoped),
  );

  it.effect("drops the least recently used cards past the bound", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "cards-" }), "cards");
      const store = yield* makeCardStore(dir);
      yield* fs.makeDirectory(dir, { recursive: true });
      const hashes = Array.from({ length: MAX_CARD_FILES }, (_, i) => cardHashOf(`p${i}`, "t"));
      for (const [i, hash] of hashes.entries()) {
        const file = path.join(dir, `${hash}.svg`);
        yield* fs.writeFileString(file, "<svg/>");
        // Older and older, so hashes[0] is the oldest.
        yield* fs.utimes(file, 1_000_000 + i, 1_000_000 + i);
      }
      // The test clock stands at 0; move it past the cards' dates so "now" is the newest.
      yield* TestClock.adjust(2_000_000_000);
      // Using the oldest card makes it the newest; the next oldest then goes first.
      assert.equal(yield* store.read(hashes[0]!), "<svg/>");
      yield* store.write(cardHashOf("new", "t"), "<svg>new</svg>");
      const names = yield* fs.readDirectory(dir);
      assert.lengthOf(names, MAX_CARD_FILES);
      assert.isFalse(names.includes(`${hashes[1]}.svg`));
      assert.isTrue(names.includes(`${hashes[0]}.svg`));
    }).pipe(Effect.scoped),
  );

  it("draws a card from the page's text only, without running anything", () => {
    let ran = false;
    (globalThis as { __ranFromPage?: () => void }).__ranFromPage = () => {
      ran = true;
    };
    const svg = fridgeSvgThumbnail(
      '<title>Hi</title><script>globalThis.__ranFromPage()</script><img src=x onerror="globalThis.__ranFromPage()">',
      "Fallback",
    );
    assert.isFalse(ran);
    assert.notInclude(svg, "<script");
    assert.notInclude(svg, "onerror");
    delete (globalThis as { __ranFromPage?: () => void }).__ranFromPage;
  });
});
