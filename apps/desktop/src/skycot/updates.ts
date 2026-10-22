/**
 * SKYCOT: the desktop updater's two fork rules (packages/skycot-brand: updateFeed, updateRestart).
 *
 * 1. Only SKYCOT's own feed. The feed electron-updater uses is the `app-update.yml` the build
 *    baked into the app. `vetBakedFeed` lets it through only when it is exactly the feed in
 *    SKYCOT's brand settings; anything else (T3 Code's releases above all, or any feed while the
 *    brand has none) leaves the updater switched off, as if no feed were configured. Seam
 *    `skycot-update-feed` in updates/DesktopUpdates.ts.
 * 2. Family profile: restarting into an update needs the parent code. `restartAllowed` reads the
 *    profile beside the engine's state and, when it is on, spends the engine's short-lived
 *    "restart allowed" note for the downloaded version. Seam `skycot-update-family-gate` in
 *    ipc/methods/updates.ts (the renderer's install call). The remote install path
 *    (`server.commitDesktopUpdate`) is checked by the engine's Family gate instead.
 */
import {
  readUpdateFeedSetting,
  SKYCOT_UPDATE_FEED_ENV,
  vetAppUpdateConfig,
} from "@t3tools/skycot-brand/updateFeed";
import {
  FAMILY_PROFILE_FILE_NAME,
  RESTART_UNLOCK_FILE_NAME,
  familyProfileOn,
  restartUnlockAllows,
} from "@t3tools/skycot-brand/updateRestart";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import type * as DesktopUpdates from "../updates/DesktopUpdates.ts";

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("skycot-updates");

/** The baked feed when it is SKYCOT's own; otherwise none, so the updater stays off. */
export const vetBakedFeed = Effect.fn("skycot.updates.vetBakedFeed")(function* <
  A extends Readonly<Record<string, string>>,
>(baked: Option.Option<A>, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (Option.isNone(baked)) return baked;
  const verdict = vetAppUpdateConfig(
    baked.value,
    readUpdateFeedSetting(env[SKYCOT_UPDATE_FEED_ENV]),
  );
  if (verdict.allowed) return baked;
  yield* logWarning("update feed refused; automatic updates stay off", {
    reason: verdict.reason,
  });
  return Option.none<A>();
});

const readText = (fileSystem: FileSystem.FileSystem, path: string) =>
  fileSystem.readFileString(path).pipe(
    Effect.map((text): string | null => text),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
    }),
  );

/**
 * True when nothing stands in the way of restarting into `downloadedVersion`: the Family profile
 * is off, or a grown-up's note for that version is fresh (and is spent now). Unreadable files
 * count as "on, no note": the desktop never installs on a guess.
 */
export const restartAllowed = Effect.fn("skycot.updates.restartAllowed")(
  function* (downloadedVersion: string | null) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const profile = environment.path.join(environment.stateDir, FAMILY_PROFILE_FILE_NAME);
    const notePath = environment.path.join(environment.stateDir, RESTART_UNLOCK_FILE_NAME);
    if (!familyProfileOn(yield* readText(fileSystem, profile))) return true;
    const note = yield* readText(fileSystem, notePath);
    if (note === null) {
      yield* logInfo("restart for an update refused: the Family profile needs the parent code");
      return false;
    }
    yield* fileSystem.remove(notePath, { force: true });
    const allowed = restartUnlockAllows(note, downloadedVersion, yield* Clock.currentTimeMillis);
    if (!allowed) {
      yield* logInfo(
        "restart for an update refused: the grown-up's note is stale or for another version",
      );
    }
    return allowed;
  },
  Effect.catch((error) =>
    logWarning("could not read the Family profile; restart refused", {
      errorTag: error._tag,
    }).pipe(Effect.as(false)),
  ),
);

/** The renderer's "Restart to update": refused (nothing happens) unless `restartAllowed`. */
export const installWithFamilyRule = Effect.fn("skycot.updates.installWithFamilyRule")(function* (
  updates: DesktopUpdates.DesktopUpdates["Service"],
) {
  const { downloadedVersion } = yield* updates.getState;
  if (!(yield* restartAllowed(downloadedVersion))) {
    return { accepted: false, completed: false, state: yield* updates.getState };
  }
  return yield* updates.install;
});
