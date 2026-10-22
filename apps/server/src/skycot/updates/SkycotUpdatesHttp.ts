// SKYCOT's own updates, from the engine's side: `/api/skycot/updates/*`, authenticated like the
// Family routes.
//
// - `GET /api/skycot/updates`: this engine's version, and whether a newer SKYCOT exists. The
//   engine only knows that when SKYCOT's brand settings name a feed (packages/skycot-brand
//   updateFeed); then it reads the feed's `latest-mac.yml` (a few hundred bytes, no download) at
//   most every few hours. With no feed it contacts nothing and says so. It never asks T3 Code's
//   servers: a feed that names them is refused before any request.
// - `POST /api/skycot/updates/allow-restart`: the Family profile's door for "Restart to update".
//   With the profile on, it needs a grown-up's "yes" for updates (the parent code, purpose
//   `update`, or the Advanced-mode master grant) and then writes the short-lived note the desktop
//   app's install handler requires (packages/skycot-brand updateRestart). With the profile off it
//   writes nothing and says no note is needed.

import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  compareVersions,
  latestMacManifestUrl,
  readManifestVersion,
  readUpdateFeedSetting,
  SKYCOT_UPDATE_FEED_ENV,
  type SkycotUpdateFeedSetting,
} from "@t3tools/skycot-brand/updateFeed";
import {
  encodeRestartUnlock,
  RESTART_UNLOCK_FILE_NAME,
  RESTART_UNLOCK_TTL_MS,
} from "@t3tools/skycot-brand/updateRestart";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import { HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import packageJson from "../../../package.json" with { type: "json" };
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";

export const UPDATES_ROUTE = "/api/skycot/updates";

/** A good answer is kept this long; a failed look is retried sooner. */
const CHECK_TTL_MS = 6 * 60 * 60_000;
const FAILED_CHECK_TTL_MS = 30 * 60_000;
const CHECK_TIMEOUT = Duration.seconds(10);

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

export type FeedState = "none" | "configured" | "refused";

export interface UpdatesStatus {
  /** This engine's version (the desktop app ships the same one). */
  readonly version: string;
  /** Started by the Mac app: the app updates both, so a browser is told to look there. */
  readonly desktop: boolean;
  readonly feed: FeedState;
  /** The newest version the feed describes, when the engine could read it. */
  readonly latestVersion: string | null;
  readonly newer: boolean;
}

export function feedState(setting: SkycotUpdateFeedSetting): FeedState {
  if (!setting.branded) return "none";
  if (setting.feed !== null) return "configured";
  return setting.problem === null ? "none" : "refused";
}

interface CachedCheck {
  readonly at: number;
  readonly ok: boolean;
  readonly latestVersion: string | null;
}

/**
 * The newest version the feed names, or null. Pure apart from `fetchText`, which is only called
 * for a feed that passed the brand rules (never T3 Code's).
 */
export const latestVersionFrom = Effect.fn("SkycotUpdates.latestVersionFrom")(function* (
  setting: SkycotUpdateFeedSetting,
  fetchText: (url: string) => Effect.Effect<string | null>,
) {
  if (!setting.branded || setting.feed === null) return null;
  const url = latestMacManifestUrl(setting.feed);
  if (url === null) return null;
  const text = yield* fetchText(url);
  return text === null ? null : readManifestVersion(text);
});

/** The caller's session, or the answer to send instead (same rules as the Family routes). */
const sessionOrRefusal = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* auth
    .authenticateHttpRequest(request)
    .pipe(Effect.orElseSucceed(() => null));
  if (session === null) {
    return {
      refusal: json({ error: "unauthenticated", message: "Sign in to SKYCOT again." }, 401),
    } as const;
  }
  if (!session.scopes.includes(AuthOrchestrationOperateScope)) {
    return {
      refusal: json({ error: "forbidden", message: "This device cannot do that." }, 403),
    } as const;
  }
  return { sessionId: session.sessionId } as const;
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const cache = yield* Ref.make<CachedCheck | null>(null);
    const httpClient = yield* Effect.serviceOption(HttpClient.HttpClient);

    const fetchText = (url: string): Effect.Effect<string | null> =>
      Option.match(httpClient, {
        onNone: () => Effect.succeed(null),
        onSome: (client) =>
          client.get(url).pipe(
            Effect.flatMap((response) =>
              response.status === 200 ? response.text : Effect.succeed(null),
            ),
            Effect.timeout(CHECK_TIMEOUT),
            Effect.orElseSucceed(() => null),
          ),
      });

    const latest = Effect.gen(function* () {
      const setting = readUpdateFeedSetting(process.env[SKYCOT_UPDATE_FEED_ENV]);
      if (feedState(setting) !== "configured") return { setting, latestVersion: null };
      const now = yield* Clock.currentTimeMillis;
      const cached = yield* Ref.get(cache);
      if (cached !== null && now - cached.at < (cached.ok ? CHECK_TTL_MS : FAILED_CHECK_TTL_MS)) {
        return { setting, latestVersion: cached.latestVersion };
      }
      const latestVersion = yield* latestVersionFrom(setting, fetchText);
      yield* Ref.set(cache, { at: now, ok: latestVersion !== null, latestVersion });
      return { setting, latestVersion };
    });

    const statusRoute = HttpRouter.add(
      "GET",
      UPDATES_ROUTE,
      Effect.gen(function* () {
        const session = yield* sessionOrRefusal;
        if ("refusal" in session) return session.refusal;
        const config = yield* ServerConfig.ServerConfig;
        const { setting, latestVersion } = yield* latest;
        const version = packageJson.version;
        return json({
          version,
          desktop: config.mode === "desktop",
          feed: feedState(setting),
          latestVersion,
          newer: latestVersion !== null && compareVersions(latestVersion, version) > 0,
        } satisfies UpdatesStatus);
      }).pipe(Effect.withSpan("skycot.updates.http GET /")),
    );

    const allowRestartRoute = HttpRouter.add(
      "POST",
      `${UPDATES_ROUTE}/allow-restart`,
      Effect.gen(function* () {
        const session = yield* sessionOrRefusal;
        if ("refusal" in session) return session.refusal;
        const { sessionId } = session;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const family = yield* SkycotFamily.SkycotFamily;
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const body = yield* request.json.pipe(Effect.orElseSucceed(() => ({})));
        const version =
          typeof body === "object" && body !== null && "version" in body
            ? (body as { readonly version: unknown }).version
            : undefined;
        if (typeof version !== "string" || version.trim() === "") {
          return json({ error: "invalid-request", message: "Which version?" }, 400);
        }
        if (!(yield* family.isEnabled)) return json({ allowed: true, needed: false });
        if (!(yield* family.allows({ sessionId, purpose: "update" }))) {
          return json(
            {
              error: "forbidden",
              message: SkycotFamilyGate.FAMILY_REFUSAL_MESSAGE,
              requiredPermission: SkycotFamilyGate.FAMILY_PERMISSION,
            },
            403,
          );
        }
        const expiresAt = (yield* Clock.currentTimeMillis) + RESTART_UNLOCK_TTL_MS;
        const written = yield* fs
          .writeFileString(
            path.join(config.stateDir, RESTART_UNLOCK_FILE_NAME),
            encodeRestartUnlock({ version: version.trim(), expiresAt }),
          )
          .pipe(
            Effect.as(true),
            Effect.catch((error) =>
              Effect.logWarning("Could not write the update restart note.", {
                errorTag: error._tag,
              }).pipe(Effect.as(false)),
            ),
          );
        return written
          ? json({ allowed: true, needed: true, expiresAt })
          : json({ error: "storage", message: "SKYCOT could not get ready to restart." }, 500);
      }).pipe(Effect.withSpan("skycot.updates.http POST /allow-restart")),
    );

    return Layer.mergeAll(statusRoute, allowRestartRoute);
  }),
);
