import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PAGE_COPY_POLICY, projectPathOf, selfContainedPage, withoutCode } from "./thumbnail.ts";

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

describe("the copy a phone or iPad shows", () => {
  it.effect("keeps no code at all and carries offline rules of its own", () =>
    Effect.gen(function* () {
      const { read } = project({
        "index.html": `<!doctype html><html><head><title>Dogs</title><meta http-equiv="refresh" content="0;url=https://example.com"></head><body onload="fetch('https://dog.ceo/api')">
<h1 title="1 > 0" onclick="go()">Dogs</h1><script>fetch("https://dog.ceo/a")</script>
<img src="missing.png" onerror="fetch('https://dog.ceo/b')"><img/onerror=fetch(1) alt="x">
<a href="javascript:fetch('https://dog.ceo/c')">one</a><a href=" &#106;avascript:alert(1)">two</a><a href="https://example.com" target="_blank">outside</a>
<a href="&#x6A;ava&#x09;script&colon;x">three</a><a href="pets.html">pets</a><svg onLoad="x()"></svg>
<form action="javascript:void(0)"><button formaction="javascript:x()">Go</button></form></body></html>`,
      });
      const html = (yield* selfContainedPage("index.html", read))!;
      assert.notMatch(html, /\son[a-z]+\s*=/iu);
      assert.notMatch(html, /\/on[a-z]+\s*=/iu);
      assert.notMatch(html, /javascript|&#106;|&#x6a;/iu);
      assert.notMatch(html, /<a\b[^>]*\bhref\s*=/iu);
      assert.notMatch(html, /<script|http-equiv="refresh"/iu);
      assert.include(
        html,
        `<meta http-equiv="Content-Security-Policy" content="${PAGE_COPY_POLICY}">`,
      );
      assert.isBelow(html.indexOf("Content-Security-Policy"), html.indexOf("<title>"));
      // Ordinary content and attributes stay as they were.
      assert.include(html, '<h1 title="1 > 0">Dogs</h1>');
      assert.include(html, ">pets</a>");
      assert.include(html, 'alt="x"');
    }),
  );

  it("forbids code and the internet in its own rules", () => {
    assert.include(PAGE_COPY_POLICY, "default-src 'none'");
    assert.include(PAGE_COPY_POLICY, "script-src 'none'");
    assert.notMatch(PAGE_COPY_POLICY, /https?:|\*/u);
    assert.include(withoutCode("<p>x"), "Content-Security-Policy");
  });
});
