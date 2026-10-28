// nondev-seam: skycot-update-staging-test
import { assert, describe, it } from "@effect/vitest";
import { DesktopUpdateChannelSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { vetBakedFeed } from "../skycot/updates.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { resolveDefaultDesktopUpdateChannel, updateMatchesChannel } from "./updateChannels.ts";
import { flushCallbacks, makeHarness } from "./updatesTestHarness.ts";

const BETA = "0.1.1-nondev.36.beta";

describe("staging update channel (release hop gate)", () => {
  it("never becomes the default: a beta version starts on latest", () => {
    assert.equal(resolveDefaultDesktopUpdateChannel(BETA), "latest");
    assert.equal(resolveDefaultDesktopUpdateChannel("0.1.1-nondev.36.beta-staging"), "latest");
    assert.equal(resolveDefaultDesktopUpdateChannel("1.0.0-staging.1"), "latest");
    assert.equal(resolveDefaultDesktopUpdateChannel("1.0.0"), "latest");
  });

  it("is part of the channel type, so persisted settings keep it", () => {
    assert.equal(Schema.decodeUnknownSync(DesktopUpdateChannelSchema)("staging"), "staging");
    assert.throws(() => Schema.decodeUnknownSync(DesktopUpdateChannelSchema)("beta"));
  });

  it("accepts any version its own feed lists, while latest still matches by version shape", () => {
    assert.isTrue(updateMatchesChannel("staging", BETA));
    assert.isTrue(updateMatchesChannel("latest", BETA));
    assert.isFalse(updateMatchesChannel("latest", "1.0.0-nightly.20260101.1"));
  });

  it.effect("setUpdateChannel accepts staging and points the updater at staging-mac.yml", () => {
    const harness = makeHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal((yield* updates.getState).channel, "latest");
        assert.deepStrictEqual(harness.updaterChannels(), ["latest"]);

        const changed = yield* updates.setChannel("staging");
        assert.equal(changed.channel, "staging");
        assert.equal(harness.updaterChannels().at(-1), "staging");
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("a version offered on the staging feed is taken, not ignored", () => {
    const harness = makeHarness();
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        yield* updates.setChannel("staging");
        harness.emit("update-available", { version: BETA });
        yield* flushCallbacks;
        const state = yield* updates.getState;
        assert.equal(state.status, "available");
        assert.equal(state.availableVersion, BETA);
      }),
    ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
  });

  it.effect("the production brand-feed check still refuses non-brand hosts", () =>
    Effect.gen(function* () {
      const brand = { T3CODE_SKYCOT_UPDATE_FEED: "https://downloads.skycot.com/mac/" };
      const own = { provider: "generic", url: "https://downloads.skycot.com/mac/" };
      assert.isTrue(Option.isSome(yield* vetBakedFeed(Option.some(own), brand)));
      for (const url of [
        "https://staging.example.com/mac/",
        "https://downloads.skycot.com.evil.example/mac/",
        "http://127.0.0.1:8080/mac/",
      ]) {
        assert.isTrue(
          Option.isNone(yield* vetBakedFeed(Option.some({ provider: "generic", url }), brand)),
        );
      }
      assert.isTrue(
        Option.isNone(
          yield* vetBakedFeed(
            Option.some({ provider: "github", owner: "pingdotgg", repo: "t3code" }),
            brand,
          ),
        ),
      );
    }),
  );
});
