import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DesktopUpdateState } from "@t3tools/contracts";
import { encodeRestartUnlock } from "@t3tools/skycot-brand/updateRestart";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import type * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import { installWithFamilyRule, restartAllowed, vetBakedFeed } from "./updates.ts";

const HOME = "/skycot-updates-test-home";
const PROFILE = `${HOME}/userdata/skycot-family.json`;
const NOTE = `${HOME}/userdata/skycot-update-unlock.json`;

/** An in-memory disk with the given files; removals are visible to the test. */
function setup(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const fileSystem = FileSystem.layerNoop({
    readFileString: (path) => {
      const text = disk.get(path);
      return text === undefined
        ? Effect.fail(
            PlatformError.systemError({
              module: "FileSystem",
              method: "readFileString",
              _tag: "NotFound",
              pathOrDescriptor: path,
            }),
          )
        : Effect.succeed(text);
    },
    remove: (path) => Effect.sync(() => void disk.delete(path)),
  });
  const environment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: "/unused-home",
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: HOME })),
    ),
  );
  return { disk, layer: Layer.merge(fileSystem, environment) };
}

const familyOn = JSON.stringify({ version: 2, enabled: true });
const note = (version: string) => encodeRestartUnlock({ version, expiresAt: 60_000 });

describe("SKYCOT update feed", () => {
  const siteFeed = { provider: "generic", url: "https://skycot.com/downloads/mac/" };
  const t3Feed = { provider: "github", owner: "pingdotgg", repo: "t3code" };

  it.effect("keeps only the brand's own feed", () =>
    Effect.gen(function* () {
      const brand = { T3CODE_SKYCOT_UPDATE_FEED: "https://skycot.com/downloads/mac/" };
      assert.isTrue(Option.isSome(yield* vetBakedFeed(Option.some(siteFeed), brand)));
      assert.isTrue(Option.isNone(yield* vetBakedFeed(Option.some(t3Feed), brand)));
      assert.isTrue(
        Option.isNone(
          yield* vetBakedFeed(Option.some(siteFeed), { T3CODE_SKYCOT_UPDATE_FEED: "none" }),
        ),
      );
      assert.isTrue(Option.isNone(yield* vetBakedFeed(Option.some(t3Feed), {})));
    }),
  );
});

describe("Family profile: restarting into an update", () => {
  it.effect("is open while the profile is off or absent", () => {
    const { layer } = setup({});
    return Effect.gen(function* () {
      assert.isTrue(yield* restartAllowed("1.3.0"));
    }).pipe(Effect.provide(layer));
  });

  it.effect("needs the engine's note for that version, and spends it", () => {
    const { disk, layer } = setup({ [PROFILE]: familyOn, [NOTE]: note("1.3.0") });
    return Effect.gen(function* () {
      assert.isTrue(yield* restartAllowed("1.3.0"));
      assert.isFalse(disk.has(NOTE));
      assert.isFalse(yield* restartAllowed("1.3.0"));
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses without a note, for another version, or with a broken profile", () => {
    const wrongVersion = setup({ [PROFILE]: familyOn, [NOTE]: note("1.4.0") });
    const noNote = setup({ [PROFILE]: familyOn });
    const broken = setup({ [PROFILE]: "{ half" });
    return Effect.gen(function* () {
      assert.isFalse(yield* restartAllowed("1.3.0").pipe(Effect.provide(wrongVersion.layer)));
      assert.isFalse(wrongVersion.disk.has(NOTE));
      assert.isFalse(yield* restartAllowed("1.3.0").pipe(Effect.provide(noNote.layer)));
      assert.isFalse(yield* restartAllowed("1.3.0").pipe(Effect.provide(broken.layer)));
    });
  });

  it.effect("never calls the installer when refused", () => {
    const { layer } = setup({ [PROFILE]: familyOn });
    let installs = 0;
    const state = { downloadedVersion: "1.3.0" } as DesktopUpdateState;
    const updates = {
      getState: Effect.succeed(state),
      install: Effect.sync(() => {
        installs += 1;
        return { accepted: true, completed: false, state };
      }),
    } as unknown as DesktopUpdates.DesktopUpdates["Service"];
    return Effect.gen(function* () {
      const refused = yield* installWithFamilyRule(updates);
      assert.isFalse(refused.accepted);
      assert.equal(installs, 0);
    }).pipe(Effect.provide(layer));
  });
});
