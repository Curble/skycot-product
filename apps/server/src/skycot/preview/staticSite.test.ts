// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";

import {
  isInside,
  isPrivateName,
  mimeTypeFor,
  readRequestPath,
  serveStaticSite,
  type StaticSite,
} from "./staticSite.ts";

/** A raw request, so paths reach the server exactly as written (fetch would tidy `..` away). */
const rawGet = (
  port: number,
  path: string,
  options: { readonly host?: string; readonly method?: string } = {},
) =>
  new Promise<{ status: number; headers: NodeHttp.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = NodeHttp.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: { host: options.host ?? `127.0.0.1:${port}` },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => (body += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    },
  );

describe("readRequestPath", () => {
  it("reads ordinary paths, decoded, and knows a folder by its slash", () => {
    expect(readRequestPath("/")).toEqual({ kind: "path", segments: [], isFolder: true });
    expect(readRequestPath("/games/space%20race.html?level=2#top")).toEqual({
      kind: "path",
      segments: ["games", "space race.html"],
      isFolder: false,
    });
    expect(readRequestPath("/./games/")).toEqual({
      kind: "path",
      segments: ["games"],
      isFolder: true,
    });
  });

  it("refuses ways out of the folder and private files", () => {
    for (const path of [
      "/../secret.txt",
      "/games/../../etc/passwd",
      "/%2e%2e/secret.txt",
      "/games%2f..%2f..%2fsecret",
      "/a%5c..%5csecret",
      "/a%00.html",
      "/.env",
      "/.git/config",
      "/sub/.env.local",
      "/%2eenv",
      "/keys/server.pem",
      "/id_rsa",
      "/%E0%A4%A",
      "//evil.example/x",
      "secret.txt",
    ]) {
      expect(readRequestPath(path), path).toEqual({ kind: "refused" });
    }
  });

  it("knows hidden and secret names", () => {
    expect(isPrivateName(".DS_Store")).toBe(true);
    expect(isPrivateName(".npmrc")).toBe(true);
    expect(isPrivateName("site.key")).toBe(true);
    expect(isPrivateName("index.html")).toBe(false);
    expect(isPrivateName("keyboard.js")).toBe(false);
  });

  it("checks a resolved path stays inside, with nothing private on the way", () => {
    expect(isInside("/p/site", "/p/site")).toBe(true);
    expect(isInside("/p/site", "/p/site/node_modules/three/build/three.module.js")).toBe(true);
    expect(isInside("/p/site", "/p/site-2/index.html")).toBe(false);
    expect(isInside("/p/site", "/p/secret.txt")).toBe(false);
    expect(isInside("/p/site", "/p/site/.git/config")).toBe(false);
  });
});

describe("mimeTypeFor", () => {
  it("names the types a browser needs to run and draw a page", () => {
    expect(mimeTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(mimeTypeFor("style.css")).toBe("text/css; charset=utf-8");
    expect(mimeTypeFor("app.mjs")).toBe("text/javascript; charset=utf-8");
    expect(mimeTypeFor("three.module.js")).toBe("text/javascript; charset=utf-8");
    expect(mimeTypeFor("data.json")).toBe("application/json; charset=utf-8");
    expect(mimeTypeFor("logo.svg")).toBe("image/svg+xml");
    expect(mimeTypeFor("game.wasm")).toBe("application/wasm");
    expect(mimeTypeFor("cat.PNG")).toBe("image/png");
    expect(mimeTypeFor("dog.jpeg")).toBe("image/jpeg");
    expect(mimeTypeFor("spin.gif")).toBe("image/gif");
    expect(mimeTypeFor("pic.webp")).toBe("image/webp");
    expect(mimeTypeFor("boing.mp3")).toBe("audio/mpeg");
    expect(mimeTypeFor("beep.wav")).toBe("audio/wav");
    expect(mimeTypeFor("song.ogg")).toBe("audio/ogg");
    expect(mimeTypeFor("font.woff2")).toBe("font/woff2");
    expect(mimeTypeFor("README")).toBe("application/octet-stream");
  });
});

describe("serveStaticSite", () => {
  let dir: string;
  let site: StaticSite;

  beforeAll(async () => {
    dir = await NodeFSP.realpath(
      await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "skycot-page-")),
    );
    const root = NodePath.join(dir, "site");
    const write = async (relative: string, text: string) => {
      await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, relative)), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(root, relative), text);
    };
    await write("index.html", "<h1>My game</h1>");
    await write("style.css", "h1 { color: hotpink; }");
    await write("app.mjs", "await import('./node_modules/three/build/three.module.js');");
    await write("node_modules/three/build/three.module.js", "export const REVISION = '186';");
    await write("levels/index.html", "<h1>Levels</h1>");
    await write("empty/readme.txt", "no page here");
    await write(".env", "SECRET=1");
    await write(".git/config", "[core]");
    await NodeFSP.writeFile(NodePath.join(dir, "outside.txt"), "not yours");
    await NodeFSP.symlink(NodePath.join(dir, "outside.txt"), NodePath.join(root, "escape.txt"));
    await NodeFSP.symlink(dir, NodePath.join(root, "up"));
    await NodeFSP.symlink(NodePath.join(root, ".env"), NodePath.join(root, "config.txt"));
    site = await serveStaticSite(root);
  });

  afterAll(async () => {
    await site?.close();
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });

  it("listens on 127.0.0.1 only", () => {
    expect(site.url).toBe(`http://127.0.0.1:${site.port}/`);
  });

  it("serves index.html for the folder and for a subfolder, never a listing", async () => {
    const home = await rawGet(site.port, "/");
    expect(home.status).toBe(200);
    expect(home.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(home.headers["cache-control"]).toBe("no-store");
    expect(home.body).toBe("<h1>My game</h1>");
    expect((await rawGet(site.port, "/levels/")).body).toBe("<h1>Levels</h1>");
    const bare = await rawGet(site.port, "/levels?x=1");
    expect(bare.status).toBe(301);
    expect(bare.headers.location).toBe("/levels/?x=1");
    const empty = await rawGet(site.port, "/empty/");
    expect(empty.status).toBe(404);
    expect(empty.body).not.toContain("readme.txt");
  });

  it("serves a plain page's own files with the right types, node_modules included", async () => {
    const css = await rawGet(site.port, "/style.css");
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    const app = await rawGet(site.port, "/app.mjs");
    expect(app.status).toBe(200);
    expect(app.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    const three = await rawGet(site.port, "/node_modules/three/build/three.module.js");
    expect(three.status).toBe(200);
    expect(three.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(three.body).toContain("REVISION");
    const head = await rawGet(site.port, "/style.css", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });

  it("refuses escapes, links out, and hidden or secret files", async () => {
    for (const path of [
      "/../outside.txt",
      "/%2e%2e/outside.txt",
      "/levels/../../outside.txt",
      "/escape.txt",
      "/up/outside.txt",
      "/config.txt",
      "/.env",
      "/.git/config",
      "/%2eenv",
      "/nope.html",
    ]) {
      const answer = await rawGet(site.port, path);
      expect(answer.status, path).toBe(404);
      expect(answer.body, path).not.toMatch(/not yours|SECRET|\[core\]/);
    }
  });

  it("answers only to this Mac's own names for it, and only to reading", async () => {
    expect((await rawGet(site.port, "/", { host: "evil.example" })).status).toBe(403);
    expect((await rawGet(site.port, "/", { host: `localhost:${site.port}` })).status).toBe(200);
    expect((await rawGet(site.port, "/", { method: "POST" })).status).toBe(405);
  });

  it("stops answering once closed", async () => {
    const other = await serveStaticSite(NodePath.join(dir, "site"));
    await other.close();
    await expect(rawGet(other.port, "/")).rejects.toThrow();
  });
});
