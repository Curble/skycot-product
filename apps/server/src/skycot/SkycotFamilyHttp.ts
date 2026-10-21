// HTTP transport for the Family profile: `/api/skycot/family/*`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. Each handler decodes, calls one
// SkycotFamily method and maps its error to a plain JSON answer the client shows as it is.
// Also the developer-interface page gate the static handler calls (one seam in http.ts).

import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import type { AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkycotFamily from "./SkycotFamily.ts";

export const FAMILY_ROUTE = "/api/skycot/family";

const NO_STORE = { "cache-control": "no-store" } as const;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { ...NO_STORE, ...headers } });

const STATUS_BY_REASON: Readonly<Record<SkycotFamily.FamilyFailureReason, number>> = {
  "not-enabled": 409,
  "already-enabled": 409,
  "invalid-code": 400,
  "invalid-request": 400,
  "wrong-code": 403,
  locked: 429,
  storage: 500,
};

const failureResponse = (error: SkycotFamily.FamilyError) =>
  json(
    {
      error: error.reason,
      message: error.message,
      ...(error.attemptsLeft === undefined ? {} : { attemptsLeft: error.attemptsLeft }),
      ...(error.remainingMs === undefined ? {} : { remainingMs: error.remainingMs }),
    },
    STATUS_BY_REASON[error.reason],
  );

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const nullableText = (value: unknown) => (typeof value === "string" ? value : null);

const unlockCookie = (token: string, maxAgeSeconds: number) =>
  `${SkycotFamily.UNLOCK_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict`;
const expiredUnlockCookie = `${SkycotFamily.UNLOCK_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;

type Handler = (input: {
  readonly sessionId: string;
  readonly body: Record<string, unknown>;
  readonly family: SkycotFamily.SkycotFamily["Service"];
  /**
   * Pins the engine default to "Ask me first". The runtime policy downgrades every turn
   * anyway; this keeps Settings and new threads honest about it.
   */
  readonly pinSafeDefault: Effect.Effect<void>;
}) => Effect.Effect<HttpServerResponse.HttpServerResponse, SkycotFamily.FamilyError, never>;

const route = (
  method: "GET" | "POST",
  path: string,
  scope: AuthEnvironmentScope,
  handler: Handler,
) =>
  HttpRouter.add(
    method,
    `${FAMILY_ROUTE}${path}`,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const family = yield* SkycotFamily.SkycotFamily;
      const settings = yield* ServerSettings.ServerSettingsService;
      const pinSafeDefault = Effect.suspend(() =>
        settings.updateSettings({ defaultRuntimeMode: "approval-required" }),
      ).pipe(
        Effect.ignoreCause({
          log: true,
          message: "Could not pin the Family default runtime mode.",
        }),
      );
      const session = yield* auth
        .authenticateHttpRequest(request)
        .pipe(Effect.orElseSucceed(() => null));
      if (session === null) {
        return json({ error: "unauthenticated", message: "Sign in to SKYCOT again." }, 401);
      }
      if (!session.scopes.includes(scope)) {
        return json(
          {
            error: "forbidden",
            message: "This device is not allowed to change the Family profile.",
          },
          403,
        );
      }
      const body =
        method === "POST" ? record(yield* request.json.pipe(Effect.orElseSucceed(() => ({})))) : {};
      return yield* handler({ sessionId: session.sessionId, body, family, pinSafeDefault }).pipe(
        Effect.catchTags({
          SkycotFamilyError: (error) => Effect.succeed(failureResponse(error)),
        }),
      );
    }).pipe(Effect.withSpan(`skycot.family.http ${method} ${path || "/"}`)),
  );

const statusRoute = route("GET", "", AuthOrchestrationOperateScope, ({ family }) =>
  family.status.pipe(Effect.map((status) => json(status))),
);

const enableRoute = route(
  "POST",
  "/enable",
  AuthSettingsWriteScope,
  ({ family, body, pinSafeDefault }) =>
    Effect.gen(function* () {
      const status = yield* family.enable({
        code: text(body["code"]),
        childName: nullableText(body["childName"]),
      });
      yield* pinSafeDefault;
      return json(status);
    }),
);

const verifyRoute = route(
  "POST",
  "/verify",
  AuthOrchestrationOperateScope,
  ({ family, body, sessionId }) =>
    Effect.gen(function* () {
      const purpose = text(body["purpose"]) as SkycotFamily.FamilyPurpose;
      const requestId = nullableText(body["requestId"]) ?? undefined;
      const unlock = yield* family.verify({
        code: text(body["code"]),
        purpose,
        sessionId,
        requestId,
      });
      // The developer interface is a page load, not an RPC: it needs a cookie the static
      // handler can read. HttpOnly, so nothing in either client can copy it.
      const headers =
        unlock.purpose === "advanced"
          ? {
              "set-cookie": unlockCookie(
                unlock.token,
                Math.floor(SkycotFamily.GRANT_TTL_MS.advanced / 1000),
              ),
            }
          : {};
      return json(unlock, 200, headers);
    }),
);

const disableRoute = route("POST", "/disable", AuthSettingsWriteScope, ({ family, body }) =>
  family
    .disable({ code: text(body["code"]) })
    .pipe(Effect.map((status) => json(status, 200, { "set-cookie": expiredUnlockCookie }))),
);

const changeCodeRoute = route("POST", "/change-code", AuthSettingsWriteScope, ({ family, body }) =>
  family
    .changeCode({ oldCode: text(body["oldCode"]), newCode: text(body["newCode"]) })
    .pipe(Effect.map((status) => json(status, 200, { "set-cookie": expiredUnlockCookie }))),
);

const renameRoute = route("POST", "/rename", AuthOrchestrationOperateScope, ({ family, body }) =>
  family
    .rename({ childName: nullableText(body["childName"]) })
    .pipe(Effect.map((status) => json(status))),
);

const lockRoute = route("POST", "/lock", AuthOrchestrationOperateScope, ({ family, sessionId }) =>
  family.lock({ sessionId }).pipe(
    Effect.andThen(family.status),
    Effect.map((status) => json(status, 200, { "set-cookie": expiredUnlockCookie })),
  ),
);

export const layer = Layer.mergeAll(
  statusRoute,
  enableRoute,
  verifyRoute,
  disableRoute,
  changeCodeRoute,
  renameRoute,
  lockRoute,
);

function isPagePath(path: Path.Path, pathname: string): boolean {
  const ext = path.extname(pathname);
  return ext === "" || ext === ".html";
}

/**
 * While the Family profile is on, any page outside `/simple/` (the developer interface and
 * its routes, `/pair` included: the redirect keeps the `#token` fragment) redirects to the
 * plain client unless the browser holds a live Advanced-mode unlock cookie. Assets still
 * load: a script file is not an interface.
 *
 * Dev mode is skipped: there the stock client is served by its own Vite port, not by this
 * handler, so a redirect here would protect nothing. The RPC gate covers both.
 */
export const developerPageRedirect = Effect.fn("SkycotFamilyHttp.developerPageRedirect")(function* (
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
) {
  const config = yield* ServerConfig.ServerConfig;
  if (config.devUrl) return null;
  const pathname = url.pathname;
  if (pathname === "/simple" || pathname.startsWith("/simple/")) return null;
  const path = yield* Path.Path;
  if (!isPagePath(path, pathname)) return null;
  // Optional so the static route's type (and upstream's tests) stay as they were.
  const familyService = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  if (Option.isNone(familyService)) return null;
  const family = familyService.value;
  if (!(yield* family.isEnabled)) return null;
  const cookie = request.cookies[SkycotFamily.UNLOCK_COOKIE_NAME];
  if (yield* family.tokenAllows(cookie, "advanced")) return null;
  return HttpServerResponse.redirect("/simple/", { status: 302, headers: NO_STORE });
});
