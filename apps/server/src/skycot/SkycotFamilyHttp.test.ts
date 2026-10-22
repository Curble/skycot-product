// The Family routes and the developer-interface page gate, through a real HTTP server.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, AuthStandardClientScopes } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerHttp from "../http.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyHttp from "./SkycotFamilyHttp.ts";

const CODE = "482913";
const BEARER = "Bearer parent-device";

const makeClient = Effect.fn("SkycotFamilyHttpTest.makeClient")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-http-" });
  const staticDir = path.join(dir, "client");
  yield* fs.makeDirectory(path.join(staticDir, "simple"), { recursive: true });
  yield* fs.makeDirectory(path.join(staticDir, "assets"), { recursive: true });
  yield* fs.writeFileString(path.join(staticDir, "assets", "index-abc12345.js"), "// bundle");
  yield* fs.writeFileString(path.join(staticDir, "index.html"), "<p>developer interface</p>");
  yield* fs.writeFileString(path.join(staticDir, "simple", "index.html"), "<p>SKYCOT</p>");
  const pinned: Array<unknown> = [];

  const layerDependencies = Layer.mergeAll(
    SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME)),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      authenticateHttpRequest: (request) =>
        request.headers["authorization"] === BEARER
          ? Effect.succeed({
              sessionId: AuthSessionId.make("session-parent"),
              subject: "parent",
              method: "bearer" as never,
              scopes: AuthStandardClientScopes,
            })
          : (Effect.fail({ _tag: "NoCredential" }) as never),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      updateSettings: (patch) => {
        pinned.push(patch);
        return Effect.succeed({} as never);
      },
    }),
  );
  const layerApp = Layer.mergeAll(SkycotFamilyHttp.layer, ServerHttp.layerStaticAndDevRoute).pipe(
    Layer.provideMerge(NodeHttpPlatform.layer),
  );
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(layerDependencies),
      Layer.provideMerge(ServerConfig.layer({ ...config, staticDir, devUrl: undefined })),
      Layer.provideMerge(Layer.succeed(FileSystem.FileSystem, fs)),
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  const send = (
    method: "GET" | "POST",
    resource: string,
    options: { readonly body?: unknown; readonly headers?: Record<string, string> } = {},
  ) =>
    client.execute(
      options.body === undefined
        ? HttpClientRequest.make(method)(resource, {
            headers: { authorization: BEARER, ...options.headers },
          })
        : HttpClientRequest.make(method)(resource, {
            headers: { authorization: BEARER, ...options.headers },
          }).pipe(HttpClientRequest.bodyJsonUnsafe(options.body)),
    );
  return { send, pinned };
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "skycot-family-http-config-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("Family profile over HTTP", (it) => {
  it.effect(
    "turns on, refuses a wrong code in plain words, and locks the developer interface",
    () =>
      Effect.gen(function* () {
        const { send, pinned } = yield* makeClient();
        const before = yield* send("GET", "/api/skycot/family");
        assert.equal(before.status, 200);
        assert.equal(((yield* before.json) as { enabled: boolean }).enabled, false);
        assert.equal((yield* send("GET", "/")).status, 200);

        const on = yield* send("POST", "/api/skycot/family/enable", {
          body: { code: CODE, childName: "Ava" },
        });
        assert.equal(on.status, 200);
        assert.deepEqual(pinned, [{ defaultRuntimeMode: "approval-required" }]);

        // The test client follows the redirect, so the page that comes back is the plain one.
        const root = yield* send("GET", "/");
        assert.equal(root.status, 200);
        const rootText = yield* root.text;
        assert.include(rootText, "SKYCOT");
        assert.notInclude(rootText, "developer interface");
        const settingsRoute = yield* send("GET", "/settings");
        assert.notInclude(yield* settingsRoute.text, "developer interface");
        assert.equal((yield* send("GET", "/simple/")).status, 200);
        // QA FK-02: any address the single-page-app fallback answers is the developer page.
        for (const resource of [
          "/axolotl.png",
          "/a.json",
          "/foo.html",
          "/settings/general.x",
          "/%2e%2e/",
          "/assets%2Findex-abc12345.js",
          "/simple/x",
          "/simple/x.png",
        ]) {
          const page = yield* send("GET", resource, { headers: { accept: "text/html" } });
          const pageText = yield* page.text;
          assert.notInclude(pageText, "developer interface", resource);
          assert.include(pageText, "SKYCOT", resource);
        }
        const asset = yield* send("GET", "/assets/index-abc12345.js");
        assert.equal(asset.status, 200);
        assert.equal(yield* asset.text, "// bundle");

        const wrong = yield* send("POST", "/api/skycot/family/verify", {
          body: { code: "000000", purpose: "advanced" },
        });
        assert.equal(wrong.status, 403);
        const body = (yield* wrong.json) as {
          error: string;
          message: string;
          attemptsLeft: number;
        };
        assert.equal(body.error, "wrong-code");
        assert.equal(body.attemptsLeft, 4);
        assert.match(body.message, /not the parent code/);
      }),
  );

  it.effect("the parent code opens the developer interface with an HttpOnly cookie", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      yield* send("POST", "/api/skycot/family/enable", { body: { code: CODE, childName: null } });
      const unlock = yield* send("POST", "/api/skycot/family/verify", {
        body: { code: CODE, purpose: "advanced" },
      });
      assert.equal(unlock.status, 200);
      const cookie = unlock.headers["set-cookie"];
      const header = Array.isArray(cookie) ? cookie[0]! : String(cookie);
      assert.include(header, `${SkycotFamily.UNLOCK_COOKIE_NAME}=`);
      assert.include(header, "HttpOnly");
      const pair = header.split(";")[0]!;
      const page = yield* send("GET", "/", { headers: { cookie: pair } });
      assert.equal(page.status, 200);
      assert.include(yield* page.text, "developer interface");
    }),
  );

  it.effect("refuses a device that is not signed in", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      const response = yield* send("POST", "/api/skycot/family/enable", {
        body: { code: CODE, childName: null },
        headers: { authorization: "Bearer stranger" },
      });
      assert.equal(response.status, 401);
    }),
  );
});
