// HTTP transport for Files and Quick Look: `/api/skycot/files`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. All routes only read, so any
// signed-in device may use them; the Family profile's rules live in SkycotFiles.
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SkycotFiles from "./SkycotFiles.ts";

export const FILES_ROUTE = "/api/skycot/files";

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const queryOf = (value: string | null): string => (value ?? "").slice(0, 1000);

const idOf = (value: string | null): string | null =>
  value !== null && value.trim().length > 0 && value.length <= 200 ? value : null;

// A refusal is an answer, not a failed request: 200 with `error`, like the Family routes.
const refusal = (error: SkycotFiles.SkycotFilesError) =>
  json({ error: error.reason, message: error.message });

type Handler = (input: {
  readonly target: SkycotFiles.FilesTarget & { readonly query: string };
  readonly files: SkycotFiles.SkycotFiles["Service"];
}) => Effect.Effect<HttpServerResponse.HttpServerResponse>;

const route = (path: string, handler: Handler) =>
  // Taken when the routes are built: route handlers only see the server's top-level services.
  Layer.unwrap(
    Effect.gen(function* () {
      const files = yield* SkycotFiles.SkycotFiles;
      return HttpRouter.add(
        "GET",
        `${FILES_ROUTE}${path}`,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const auth = yield* EnvironmentAuth.EnvironmentAuth;
          const session = yield* auth
            .authenticateHttpRequest(request)
            .pipe(Effect.orElseSucceed(() => null));
          if (session === null) {
            return json({ error: "unauthenticated", message: "Sign in to SKYCOT again." }, 401);
          }
          const url = HttpServerRequest.toURL(request);
          const query = Option.isSome(url) ? url.value.searchParams : new URLSearchParams();
          const projectId = idOf(query.get("projectId"));
          if (projectId === null) {
            return json({ error: "invalid-request", message: "Which project?" }, 400);
          }
          const threadId = idOf(query.get("threadId"));
          return yield* handler({
            target: {
              sessionId: session.sessionId,
              projectId: ProjectId.make(projectId),
              ...(threadId === null ? {} : { threadId: ThreadId.make(threadId) }),
              path: query.get("path") ?? "",
              query: queryOf(query.get("q")),
            },
            files,
          });
        }).pipe(Effect.withSpan(`skycot.files.http GET ${path}`)),
      );
    }),
  );

export const layerRoutes = Layer.mergeAll(
  route("/list", ({ target, files }) =>
    files.list(target).pipe(
      Effect.map((listing) => json(listing)),
      Effect.catchTags({ SkycotFilesError: (error) => Effect.succeed(refusal(error)) }),
    ),
  ),
  route("/search", ({ target, files }) =>
    files.search(target).pipe(
      Effect.map((found) => json(found)),
      Effect.catchTags({ SkycotFilesError: (error) => Effect.succeed(refusal(error)) }),
    ),
  ),
  route("/read", ({ target, files }) =>
    files.read(target).pipe(
      Effect.map((file) => json(file)),
      Effect.catchTags({ SkycotFilesError: (error) => Effect.succeed(refusal(error)) }),
    ),
  ),
);

/** The routes with their service; the projections and the Family profile come from above. */
export const layer = layerRoutes.pipe(Layer.provide(SkycotFiles.layer));
