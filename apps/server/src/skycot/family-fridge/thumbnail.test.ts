import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { projectPathOf, selfContainedPage } from "./thumbnail.ts";

const encoder = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const project = (files: Record<string, string | Uint8Array>) => {
  const asked: Array<string> = [];
  const read = (path: string) =>
    Effect.sync(() => {
      asked.push(path);
      const file = files[path];
      return file === undefined ? null : typeof file === "string" ? encoder.encode(file) : file;
    });
  return { read, asked };
};

/** Every place a document could make the frame ask for something. */
const REQUEST =
  /<link\b|<script\b|<iframe\b|<base\b|srcset=|(?:src|href|poster|data)="(?!data:|#)[^"]|url\("(?!data:)[^"]/iu;

describe("selfContainedPage", () => {
  it.effect("puts the page's own stylesheet and pictures inside it", () =>
    Effect.gen(function* () {
      const { read } = project({
        "pets/index.html": `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
<body><img src="cat.png" alt="Bubbles"><div style="background: url('img/bg.png')">hi</div></body></html>`,
        "pets/style.css": `body { background: url(img/bg.png); color: hotpink }`,
        "pets/cat.png": PNG,
        "pets/img/bg.png": PNG,
      });
      const html = yield* selfContainedPage("pets/index.html", read);
      assert.isNotNull(html);
      assert.include(html!, '<style>body { background: url("data:image/png;base64,iVBORw==");');
      assert.include(html!, "color: hotpink");
      assert.include(html!, 'src="data:image/png;base64,iVBORw=="');
      assert.include(html!, "Bubbles");
      assert.notMatch(html!, REQUEST);
    }),
  );

  it.effect("leaves out everything that would reach outside the project", () =>
    Effect.gen(function* () {
      const { read, asked } = project({
        "index.html": `<html><head>
<link rel="stylesheet" href="https://fonts.example.com/kid.css">
<link rel="stylesheet" href="../../secrets.css">
<link rel="icon" href="favicon.png">
<base href="https://example.com/">
<script src="game.js"></script><script>alert(1)</script>
</head><body>
<img src="https://example.com/cat.png" srcset="cat-2x.png 2x">
<img src="missing.png"><iframe src="https://example.com"></iframe>
<style>@import url("https://example.com/x.css"); h1 { background: url(//cdn.example.com/a.png) }</style>
</body></html>`,
      });
      const html = yield* selfContainedPage("index.html", read);
      assert.isNotNull(html);
      assert.notMatch(html!, REQUEST);
      assert.notInclude(html!, "example.com");
      assert.notInclude(html!, "alert(1)");
      assert.notInclude(asked, "../../secrets.css");
      assert.isFalse(asked.some((path) => path.includes("secrets")));
    }),
  );

  it.effect("is null when the page is not there", () =>
    Effect.gen(function* () {
      assert.isNull(yield* selfContainedPage("gone.html", project({}).read));
    }),
  );
});

describe("projectPathOf", () => {
  it("resolves the page's own relative paths and refuses the rest", () => {
    assert.equal(projectPathOf("pets", "style.css"), "pets/style.css");
    assert.equal(projectPathOf("pets", "./img/../cat.png?v=2#top"), "pets/cat.png");
    assert.equal(projectPathOf("pets", "/shared/logo.png"), "shared/logo.png");
    assert.equal(projectPathOf("pets", "my%20cat.png"), "pets/my cat.png");
    assert.isNull(projectPathOf("", "../outside.css"));
    assert.isNull(projectPathOf("pets", "../../outside.css"));
    assert.isNull(projectPathOf("pets", "https://example.com/a.css"));
    assert.isNull(projectPathOf("pets", "//example.com/a.css"));
    assert.isNull(projectPathOf("pets", "data:image/png;base64,AAAA"));
    assert.isNull(projectPathOf("pets", "#top"));
  });
});
