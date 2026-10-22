// HTTP transport for the sticker book: `/api/skycot/badges`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. Reading is open to any signed-in
// device; reporting what happened needs the scope that sends messages.

import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { isBadgeId, parseBadgeEvent } from "@t3tools/skycot-rules/badges";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SkycotBadges from "./SkycotBadges.ts";

export const BADGES_ROUTE = "/api/skycot/badges";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

type Handler = (input: {
  readonly sessionId: string;
  readonly body: Record<string, unknown>;
  readonly badges: SkycotBadges.SkycotBadges["Service"];
}) => Effect.Effect<HttpServerResponse.HttpServerResponse>;

const route = (method: "GET" | "POST", path: string, needsOperate: boolean, handler: Handler) =>
  // Taken when the routes are built: route handlers only see the server's top-level services.
  Layer.unwrap(
    Effect.gen(function* () {
      const badges = yield* SkycotBadges.SkycotBadges;
      return HttpRouter.add(
        method,
        `${BADGES_ROUTE}${path}`,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const auth = yield* EnvironmentAuth.EnvironmentAuth;
          // Read the body before any early answer (an early reply drops the connection).
          const body =
            method === "POST"
              ? record(yield* request.json.pipe(Effect.orElseSucceed(() => ({}))))
              : {};
          const session = yield* auth
            .authenticateHttpRequest(request)
            .pipe(Effect.orElseSucceed(() => null));
          if (session === null) {
            return json({ error: "unauthenticated", message: "Sign in to SKYCOT again." }, 401);
          }
          if (needsOperate && !session.scopes.includes(AuthOrchestrationOperateScope)) {
            return json({ error: "forbidden", message: "This device can only look." }, 403);
          }
          return yield* handler({ sessionId: session.sessionId, body, badges });
        }).pipe(Effect.withSpan(`skycot.badges.http ${method} ${path || "/"}`)),
      );
    }),
  );

const answer = (result: SkycotBadges.BadgeAnswer) =>
  json({ book: result.book, earned: result.earned });

const layerRoutes = Layer.mergeAll(
  route("GET", "", false, ({ sessionId, badges }) =>
    badges.forSession({ sessionId }).pipe(Effect.map(answer)),
  ),
  route("POST", "/event", true, ({ sessionId, body, badges }) => {
    const event = parseBadgeEvent(body["event"]);
    if (event === null) {
      return Effect.succeed(
        json({ error: "invalid-request", message: "Not a sticker event." }, 400),
      );
    }
    const projectId =
      typeof body["projectId"] === "string" && body["projectId"].length <= 200
        ? body["projectId"]
        : null;
    return badges.record({ sessionId, event, projectId }).pipe(Effect.map(answer));
  }),
  route("POST", "/seen", false, ({ sessionId, body, badges }) => {
    const ids = Array.isArray(body["ids"]) ? body["ids"].filter(isBadgeId) : [];
    return badges.seen({ sessionId, ids }).pipe(Effect.map(answer));
  }),
);

/**
 * The routes with their service. Needs `SkycotFamily` and `SkycotFamilyLimits` from the layers
 * around the routes (the Family gate's layer brings the limits).
 */
export const layer = layerRoutes.pipe(Layer.provide(SkycotBadges.layer));
