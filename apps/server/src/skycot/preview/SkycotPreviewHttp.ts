// HTTP transport for the live preview: `/api/skycot/preview`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. Looking needs any signed-in device;
// starting, stopping and leaving this Mac need the scope that sends messages. Each handler
// decodes, calls one SkycotPreview method and answers in plain JSON.
import { AuthOrchestrationOperateScope, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SkycotPreview from "./SkycotPreview.ts";

export const PREVIEW_ROUTE = "/api/skycot/preview";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const threadIdOf = (value: unknown): ThreadId | null =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200
    ? (value as ThreadId)
    : null;

const badRequest = json({ error: "invalid-request", message: "Which conversation?" }, 400);

type Handler = (input: {
  readonly sessionId: string;
  readonly body: Record<string, unknown>;
  readonly query: URLSearchParams;
  readonly preview: SkycotPreview.SkycotPreview["Service"];
}) => Effect.Effect<HttpServerResponse.HttpServerResponse>;

const route = (method: "GET" | "POST", path: string, needsOperate: boolean, handler: Handler) =>
  // Taken when the routes are built: route handlers only see the server's top-level services.
  Layer.unwrap(
    Effect.gen(function* () {
      const preview = yield* SkycotPreview.SkycotPreview;
      return HttpRouter.add(
        method,
        `${PREVIEW_ROUTE}${path}`,
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
          const url = HttpServerRequest.toURL(request);
          return yield* handler({
            sessionId: session.sessionId,
            body,
            query: Option.isSome(url) ? url.value.searchParams : new URLSearchParams(),
            preview,
          });
        }).pipe(Effect.withSpan(`skycot.preview.http ${method} ${path || "/"}`)),
      );
    }),
  );

// A refusal is an answer, not a failed request: 200 with `error`, like the Family routes.
const refusal = (error: SkycotPreview.SkycotPreviewError) =>
  json({
    error: error.reason,
    message: error.message,
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
  });

export const layerRoutes = Layer.mergeAll(
  route("GET", "", false, ({ query, preview }) => {
    const threadId = threadIdOf(query.get("threadId"));
    return threadId === null
      ? Effect.succeed(badRequest)
      : preview.status(threadId).pipe(Effect.map((status) => json(status)));
  }),
  route("POST", "/start", true, ({ body, sessionId, preview }) => {
    const threadId = threadIdOf(body["threadId"]);
    if (threadId === null) return Effect.succeed(badRequest);
    const requestId = typeof body["requestId"] === "string" ? body["requestId"] : undefined;
    return preview
      .start({ threadId, sessionId, approved: body["approved"] === true, requestId })
      .pipe(
        Effect.map((status) => json(status)),
        Effect.catchTags({ SkycotPreviewError: (error) => Effect.succeed(refusal(error)) }),
      );
  }),
  route("POST", "/stop", true, ({ body, preview }) => {
    const threadId = threadIdOf(body["threadId"]);
    return threadId === null
      ? Effect.succeed(badRequest)
      : preview.stop(threadId).pipe(Effect.map((status) => json(status)));
  }),
  route("POST", "/address", true, ({ body, sessionId, preview }) => {
    const url = typeof body["url"] === "string" ? body["url"].slice(0, 2048) : "";
    return preview.checkAddress({ sessionId, url }).pipe(Effect.map((answer) => json(answer)));
  }),
);

/** The routes with their service; the engine's terminals, port scanner and Family come from above. */
export const layer = layerRoutes.pipe(Layer.provide(SkycotPreview.layer));
