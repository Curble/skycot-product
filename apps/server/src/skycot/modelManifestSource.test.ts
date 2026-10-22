import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ModelManifest from "../provider/ModelManifest.ts";
import * as ServerSettings from "../serverSettings.ts";
import { remoteModelManifestUrl, SKYCOT_MODEL_MANIFEST_URL_ENV } from "./modelManifestSource.ts";

const NEWER_MANIFEST = {
  ...ModelManifest.BUNDLED_MODEL_MANIFEST,
  updatedAt: "2999-01-01T00:00:00Z",
};

describe("remoteModelManifestUrl", () => {
  it("is none unless the brand names a SKYCOT https address", () => {
    for (const value of [
      undefined,
      "",
      "none",
      "http://example.com/model-manifest.json",
      "not a url",
      "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json",
      "https://github.com/pingdotgg/t3code/raw/main/model-manifest.json",
      "https://t3.codes/model-manifest.json",
      "https://cdn.t3.gg/model-manifest.json",
      "https://raw.githubusercontent.com/someone/t3code/main/model-manifest.json",
    ]) {
      assert.isNull(remoteModelManifestUrl(value), String(value));
    }
    assert.strictEqual(
      remoteModelManifestUrl(" https://skycot.com/models/model-manifest.json "),
      "https://skycot.com/models/model-manifest.json",
    );
  });
});

const withManifestUrl = <A, E, R>(value: string | undefined, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[SKYCOT_MODEL_MANIFEST_URL_ENV];
      if (value === undefined) delete process.env[SKYCOT_MODEL_MANIFEST_URL_ENV];
      else process.env[SKYCOT_MODEL_MANIFEST_URL_ENV] = value;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[SKYCOT_MODEL_MANIFEST_URL_ENV];
        else process.env[SKYCOT_MODEL_MANIFEST_URL_ENV] = previous;
      }),
  );

const layerService = (prefix: string, requested: Array<string>) =>
  ServerConfig.layerTest(process.cwd(), { prefix }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerSettings.layerTest({})),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requested.push(request.url);
            return HttpClientResponse.fromWeb(request, Response.json(NEWER_MANIFEST));
          }),
        ),
      ),
    ),
  );

describe("SKYCOT's model list never comes from T3 Code's repository", () => {
  it.live.each([
    { label: "without the brand bootstrap", value: undefined },
    { label: "with no address in brand.json", value: "none" },
    {
      label: "when the brand names T3 Code's own file",
      value:
        "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json",
    },
  ])("uses the bundled manifest and contacts nothing $label", ({ value }) => {
    const requested: Array<string> = [];
    return withManifestUrl(
      value,
      Effect.gen(function* () {
        // A cache an earlier build fetched from T3 Code must not outrank the bundle either.
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        yield* fs.writeFileString(
          path.join(config.stateDir, "model-manifest.json"),
          yield* ModelManifest.encodeManifestCache({ fetchedAtMs: 0, manifest: NEWER_MANIFEST }),
        );
        const service = yield* ModelManifest.make;
        assert.deepStrictEqual(yield* service.current, ModelManifest.BUNDLED_MODEL_MANIFEST);
        assert.deepStrictEqual(yield* service.refresh, ModelManifest.BUNDLED_MODEL_MANIFEST);
        assert.deepStrictEqual(yield* service.forceRefresh, ModelManifest.BUNDLED_MODEL_MANIFEST);
        assert.deepStrictEqual(requested, []);
      }).pipe(Effect.scoped, Effect.provide(layerService("skycot-model-manifest-off", requested))),
    );
  });

  const requested: Array<string> = [];
  it.live("refreshes from the address brand.json names", () =>
    withManifestUrl(
      "https://skycot.com/models/model-manifest.json",
      Effect.gen(function* () {
        const service = yield* ModelManifest.make;
        assert.deepStrictEqual(yield* service.forceRefresh, NEWER_MANIFEST);
        assert.deepStrictEqual(requested, ["https://skycot.com/models/model-manifest.json"]);
      }).pipe(Effect.scoped, Effect.provide(layerService("skycot-model-manifest-on", requested))),
    ),
  );
});
