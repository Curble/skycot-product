// nondev-seam: skycot-playable-copy-test
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { playablePage } from "./playable.ts";

const encoder = new TextEncoder();
const project = (files: Record<string, string>) => (path: string) =>
  Effect.succeed(files[path] === undefined ? null : encoder.encode(files[path]!));

describe("playablePage", () => {
  it.effect("packs classic scripts, local modules, and sealed rules", () =>
    Effect.gen(function* () {
      const result = yield* playablePage(
        "game/index.html",
        project({
          "game/index.html":
            '<html><head><script src="main.js"></script><script type="importmap">{"imports":{"alias":"./alias.mjs"}}</script><script type="module" src="main.mjs"></script></head><body><button onclick="jump()">Play</button></body></html>',
          "game/main.js": "window.classicRan=true; window.levels='levels.json'",
          "game/main.mjs":
            'import { value } from "./value.mjs"; import { alias } from "alias"; import { packageValue } from "tiny3"; window.moduleValue=value+alias+packageValue; import("./lazy.mjs").then((m)=>window.lazy=m.value);',
          "game/value.mjs": "export const value=7",
          "game/alias.mjs": "export const alias=1",
          "game/lazy.mjs": "export const value=9",
          "game/levels.json": "{}",
          "node_modules/tiny3/package.json":
            '{"exports":{".":{"import":"./index.mjs","default":"./fallback.mjs"}}}',
          "node_modules/tiny3/index.mjs": "export const packageValue=3",
          "node_modules/tiny3/fallback.mjs": "export const packageValue=4",
        }),
        ["images.dog.ceo"],
      );
      assert.isNotNull(result.html);
      assert.include(result.html!, "window.classicRan=true");
      assert.include(result.html!, "skycot-page/game/main.mjs");
      assert.notInclude(result.html!, "data:text/javascript;base64,");
      assert.notInclude(result.html!, 'type="importmap"');
      assert.include(result.html!, 'R("skycot-page/game/main.mjs")');
      assert.include(result.html!, '"node_modules/tiny3/index.mjs"');
      assert.include(result.html!, "Promise.resolve(require(");
      assert.include(result.html!, "levels.json");
      assert.include(result.html!, "window.Audio=function(s)");
      assert.include(result.html!, "https://*.dog.ceo");
      assert.include(result.html!, "window.ReactNativeWebView");
      assert.include(result.html!, "frame-src 'none'");
      const scriptPolicy = result.html!.match(/script-src [^;]*/u)?.[0] ?? "";
      assert.notInclude(scriptPolicy, "'unsafe-inline'");
      assert.notInclude(scriptPolicy, "'unsafe-eval'");
      assert.include(result.html!, "'unsafe-hashes'");
    }),
  );

  it.effect("refuses hidden paths and respects the page cap", () =>
    Effect.gen(function* () {
      const hidden = yield* playablePage(".secrets/index.html", project({}), []);
      assert.isNull(hidden.html);
      const oversized = yield* playablePage(
        "index.html",
        () => Effect.succeed(new Uint8Array(1_000_001)),
        [],
      );
      assert.equal(oversized.reason, "too-big");
      const assetTooBig = yield* playablePage(
        "index.html",
        project({ "index.html": '<img src="huge.png">', "huge.png": "x".repeat(4_000_001) }),
        [],
      );
      assert.equal(assetTooBig.reason, "too-big");
      const totalTooBig = yield* playablePage(
        "index.html",
        project({
          "index.html": '<img src="a.png"><img src="b.png"><img src="c.png">',
          "a.png": "a".repeat(4_000_000),
          "b.png": "b".repeat(4_000_000),
          "c.png": "c".repeat(4_000_000),
        }),
        [],
      );
      assert.equal(totalTooBig.reason, "too-big");
    }),
  );

  it.effect("never reads parent or hidden module paths", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const read = (path: string) => {
        asked.push(path);
        return Effect.succeed(
          path === "game/index.html"
            ? encoder.encode('<script type="module" src="main.mjs"></script>')
            : path === "game/main.mjs"
              ? encoder.encode('import "../../secret.mjs"; import "./.hidden.mjs";')
              : encoder.encode("secret"),
        );
      };
      const result = yield* playablePage("game/index.html", read, []);
      assert.isNotNull(result.html);
      assert.deepEqual(asked, ["game/index.html", "game/main.mjs"]);
      assert.notInclude(result.html!, "../../secret.mjs");
    }),
  );

  it.effect("escapes script JSON and never reads parent or private-key files", () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const read = (path: string) => {
        asked.push(path);
        return Effect.succeed(
          path === "game/index.html"
            ? encoder.encode(
                '<img src="cert.pem"><img src="server.KEY"><img src="../safe.png"><img src="%3C/script%3E%3Cscript%3Ealert(1)%3C/script%3E.png">',
              )
            : path === "game/</script><script>alert(1)</script>.png"
              ? encoder.encode("image")
              : encoder.encode("private"),
        );
      };
      const result = yield* playablePage("game/index.html", read, []);
      assert.isNotNull(result.html);
      assert.deepEqual(asked, ["game/index.html", "game/</script><script>alert(1)</script>.png"]);
      assert.include(result.html!, "\\u003c/script>");
      assert.notInclude(result.html!, "</script><script>alert(1)");
    }),
  );

  it.effect("caps the module graph", () =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        "game/index.html": '<script type="module" src="main.mjs"></script>',
      };
      files["game/main.mjs"] = Array.from(
        { length: 129 },
        (_, index) => `import "./m${index}.mjs";`,
      ).join("\n");
      for (let index = 0; index < 129; index += 1)
        files[`game/m${index}.mjs`] = `export const n${index}=${index};`;
      const result = yield* playablePage("game/index.html", project(files), []);
      assert.equal(result.reason, "too-big");
      assert.isNull(result.html);
    }),
  );
});
