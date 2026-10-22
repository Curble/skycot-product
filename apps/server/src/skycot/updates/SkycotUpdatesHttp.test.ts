// SKYCOT's update routes through a real HTTP server, and the feed rules they rely on.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { AuthSessionId, AuthStandardClientScopes } from "@t3tools/contracts";
import { readUpdateFeedSetting } from "@t3tools/skycot-brand/updateFeed";
import { RESTART_UNLOCK_FILE_NAME } from "@t3tools/skycot-brand/updateRestart";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotUpdatesHttp from "./SkycotUpdatesHttp.ts";

const CODE = "482913";
const BEARER = "Bearer the-mac";

const makeClient = Effect.fn("SkycotUpdatesHttpTest.makeClient")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-updates-http-" });
  const layerFamily = SkycotFamily.layerAt(path.join(stateDir, SkycotFamily.FAMILY_FILE_NAME));
  const layerAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
    authenticateHttpRequest: (request) =>
      request.headers["authorization"] === BEARER
        ? Effect.succeed({
            sessionId: AuthSessionId.make("session-mac"),
            subject: "mac",
            method: "bearer" as never,
            scopes: AuthStandardClientScopes,
          })
        : (Effect.fail({ _tag: "NoCredential" }) as never),
  });
  const layerApp = SkycotUpdatesHttp.layer.pipe(Layer.provideMerge(NodeHttpPlatform.layer));
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(layerFamily),
      Layer.provideMerge(layerAuth),
      Layer.provideMerge(ServerConfig.layer({ ...config, stateDir, devUrl: undefined })),
      Layer.provideMerge(Layer.succeed(FileSystem.FileSystem, fs)),
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  const family = Context.get(services, SkycotFamily.SkycotFamily);
  const send = (method: "GET" | "POST", resource: string, body?: unknown) =>
    client.execute(
      body === undefined
        ? HttpClientRequest.make(method)(resource, { headers: { authorization: BEARER } })
        : HttpClientRequest.make(method)(resource, { headers: { authorization: BEARER } }).pipe(
            HttpClientRequest.bodyJsonUnsafe(body),
          ),
    );
  const notePath = path.join(stateDir, RESTART_UNLOCK_FILE_NAME);
  return { send, family, fs, notePath };
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "skycot-updates-http-config-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("SKYCOT updates over HTTP", (it) => {
  it.effect("reports the version and, with no feed, contacts nothing", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      const response = yield* send("GET", SkycotUpdatesHttp.UPDATES_ROUTE);
      assert.equal(response.status, 200);
      const body = (yield* response.json) as unknown as SkycotUpdatesHttp.UpdatesStatus;
      assert.equal(body.feed, "none");
      assert.isNull(body.latestVersion);
      assert.isFalse(body.newer);
      assert.match(body.version, /^\d+\.\d+\.\d+/);
    }),
  );

  it.effect("needs no note while the Family profile is off", () =>
    Effect.gen(function* () {
      const { send, fs, notePath } = yield* makeClient();
      const response = yield* send("POST", `${SkycotUpdatesHttp.UPDATES_ROUTE}/allow-restart`, {
        version: "1.3.0",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(yield* response.json, { allowed: true, needed: false });
      assert.isFalse(yield* fs.exists(notePath));
    }),
  );

  it.effect("with the Family profile on, writes the note only after the parent code", () =>
    Effect.gen(function* () {
      const { send, family, fs, notePath } = yield* makeClient();
      yield* family.enable({ code: CODE, childName: "Ava" });

      const refused = yield* send("POST", `${SkycotUpdatesHttp.UPDATES_ROUTE}/allow-restart`, {
        version: "1.3.0",
      });
      assert.equal(refused.status, 403);
      assert.isFalse(yield* fs.exists(notePath));

      yield* family.verify({ code: CODE, purpose: "update", sessionId: "session-mac" });
      const allowed = yield* send("POST", `${SkycotUpdatesHttp.UPDATES_ROUTE}/allow-restart`, {
        version: "1.3.0",
      });
      assert.equal(allowed.status, 200);
      const note = JSON.parse(yield* fs.readFileString(notePath)) as { version: string };
      assert.equal(note.version, "1.3.0");
    }),
  );
});

it.effect("reads the newest version only from SKYCOT's own feed", () =>
  Effect.gen(function* () {
    const asked: Array<string> = [];
    const fetchText = (url: string) =>
      Effect.sync(() => {
        asked.push(url);
        return "version: 1.4.0\nfiles: []\n";
      });
    assert.equal(
      yield* SkycotUpdatesHttp.latestVersionFrom(
        readUpdateFeedSetting("https://skycot.com/downloads/mac/"),
        fetchText,
      ),
      "1.4.0",
    );
    assert.deepEqual(asked, ["https://skycot.com/downloads/mac/latest-mac.yml"]);
    for (const value of ["none", "github:pingdotgg/t3code", "https://t3.codes/", undefined]) {
      assert.isNull(
        yield* SkycotUpdatesHttp.latestVersionFrom(readUpdateFeedSetting(value), fetchText),
      );
    }
    assert.equal(asked.length, 1);
    assert.equal(
      SkycotUpdatesHttp.feedState(readUpdateFeedSetting("github:pingdotgg/t3code")),
      "refused",
    );
  }),
);
