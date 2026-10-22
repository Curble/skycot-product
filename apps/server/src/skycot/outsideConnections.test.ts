// The engine contacts an outside service on its own only for a person who uses it
// (docs/legal/PRIVACY-NOTES.md, "Outside connections the app makes").

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as BitbucketApi from "@t3tools/source-control-bitbucket/server/BitbucketApi";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

const bitbucket = (env: Record<string, string>, requested: Array<string>) =>
  BitbucketApi.layer.pipe(
    Layer.provide(TestSourceControlHost.layer()),
    Layer.provide(NodeServices.layer),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requested.push(`${request.url} ${request.headers["authorization"] ?? "no-auth"}`);
            return HttpClientResponse.fromWeb(
              request,
              Response.json({ username: "sam", account_id: "1" }),
            );
          }),
        ),
      ),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  );

describe("Bitbucket", () => {
  const notSignedIn: Array<string> = [];
  it.effect("is not contacted for someone who has not added a Bitbucket token", () =>
    Effect.gen(function* () {
      const api = yield* BitbucketApi.BitbucketApi;
      const auth = yield* api.probeAuth;
      assert.strictEqual(auth.status, "unauthenticated");
      assert.deepStrictEqual(notSignedIn, []);
    }).pipe(Effect.provide(bitbucket({}, notSignedIn))),
  );

  const signedIn: Array<string> = [];
  it.effect("is asked who is signed in once the person has added a token", () =>
    Effect.gen(function* () {
      const api = yield* BitbucketApi.BitbucketApi;
      const auth = yield* api.probeAuth;
      assert.strictEqual(auth.status, "authenticated");
      assert.deepStrictEqual(signedIn, ["https://api.bitbucket.org/2.0/user Bearer bb-token"]);
    }).pipe(Effect.provide(bitbucket({ T3CODE_BITBUCKET_ACCESS_TOKEN: "bb-token" }, signedIn))),
  );
});
