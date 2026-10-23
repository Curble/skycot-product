// HTTP transport for the Family profile: `/api/skycot/family/*`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. Each handler decodes, calls one
// SkycotFamily method and maps its error to a plain JSON answer the client shows as it is.
// Also the developer-interface page gate the static handler calls (one seam in http.ts).

import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import type { AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { PERSONAL_CATEGORIES } from "@t3tools/skycot-rules/personal";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkycotFridge from "./family-fridge/SkycotFridge.ts";
import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import { RECAP_RANGES, type RecapRange } from "./family-recap/recap.ts";
import * as SkycotFamilyRecap from "./family-recap/SkycotFamilyRecap.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyGate from "./SkycotFamilyGate.ts";
import * as SkycotUpdatesHttp from "./updates/SkycotUpdatesHttp.ts";

export const FAMILY_ROUTE = "/api/skycot/family";

const NO_STORE = { "cache-control": "no-store" } as const;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { ...NO_STORE, ...headers } });

const STATUS_BY_REASON: Readonly<Record<SkycotFamily.FamilyFailureReason, number>> = {
  "not-enabled": 409,
  "already-enabled": 409,
  "invalid-code": 400,
  "invalid-request": 400,
  // A wrong code is an answer to the question, not a failed request: 200 with `error`, so a
  // child's guesses do not print "Failed to load resource" in the console (QA FK-14).
  "wrong-code": 200,
  locked: 200,
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
  /** The query string, for the GET routes that take one. */
  readonly query: URLSearchParams;
  readonly family: SkycotFamily.SkycotFamily["Service"];
  readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
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
  // The limits are taken when the routes are built (they come with the Family gate's layer),
  // not per request: route handlers only see the server's top-level services.
  Layer.unwrap(
    Effect.gen(function* () {
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      return HttpRouter.add(
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
          // Read the body before any early answer: replying while the client is still sending
          // makes Node drop the connection, which the client sees as "other side closed".
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
          if (!session.scopes.includes(scope)) {
            return json(
              {
                error: "forbidden",
                message: "This device is not allowed to change the Family profile.",
              },
              403,
            );
          }
          const url = HttpServerRequest.toURL(request);
          return yield* handler({
            sessionId: session.sessionId,
            body,
            query: Option.isSome(url) ? url.value.searchParams : new URLSearchParams(),
            family,
            limits,
            pinSafeDefault,
          }).pipe(
            Effect.catchTags({
              SkycotFamilyError: (error) => Effect.succeed(failureResponse(error)),
            }),
          );
        }).pipe(Effect.withSpan(`skycot.family.http ${method} ${path || "/"}`)),
      );
    }),
  );

/**
 * The profile, plus what a grown-up has opened on this device and for how long, and who is
 * using SKYCOT here (with whether it is awake for them).
 */
const statusRoute = route(
  "GET",
  "",
  AuthOrchestrationOperateScope,
  ({ family, limits, sessionId }) =>
    Effect.gen(function* () {
      const status = yield* family.status;
      const grants = yield* family.openGrants({ sessionId });
      const session = yield* limits.forSession({ sessionId });
      return json({ ...status, grants, session });
    }),
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
        timeZone: nullableText(body["timeZone"]),
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

const grownUpFirst = json(
  {
    error: "forbidden",
    message: SkycotFamilyGate.FAMILY_REFUSAL_MESSAGE,
    requiredPermission: SkycotFamilyGate.FAMILY_PERMISSION,
  },
  403,
);

/** Whether a grown-up's "yes" for settings is open on this device (always while the profile is off). */
const settingsOpen = Effect.fn("SkycotFamilyHttp.settingsOpen")(function* (
  family: SkycotFamily.SkycotFamily["Service"],
  sessionId: string,
) {
  return !(yield* family.isEnabled) || (yield* family.allows({ sessionId, purpose: "settings" }));
});

/**
 * The children are part of the profile: names, pictures, looks and limits need a grown-up's
 * "yes" first, as for the AI settings. The parent's browser zone comes along, so bedtimes are
 * read on the household's clock.
 */
const parentRoute = (
  path: string,
  run: (input: {
    readonly family: SkycotFamily.SkycotFamily["Service"];
    readonly body: Record<string, unknown>;
  }) => Effect.Effect<unknown, SkycotFamily.FamilyError>,
) =>
  route("POST", path, AuthOrchestrationOperateScope, ({ family, body, sessionId }) =>
    Effect.gen(function* () {
      if (!(yield* settingsOpen(family, sessionId))) return grownUpFirst;
      const timeZone = nullableText(body["timeZone"]);
      if (timeZone !== null) yield* family.setTimeZone(timeZone);
      return json(yield* run({ family, body }));
    }),
  );

const childInput = (value: unknown): SkycotFamily.ChildInput => {
  const input = record(value);
  return {
    ...("name" in input ? { name: nullableText(input["name"]) } : {}),
    ...("avatar" in input ? { avatar: input["avatar"] } : {}),
    ...("look" in input ? { look: input["look"] } : {}),
    ...("largerText" in input ? { largerText: input["largerText"] } : {}),
    ...("voice" in input ? { voice: input["voice"] } : {}),
    ...("limits" in input ? { limits: input["limits"] } : {}),
  };
};

const renameRoute = parentRoute("/rename", ({ family, body }) =>
  family.rename({ childName: nullableText(body["childName"]) }),
);

const addChildRoute = parentRoute("/children/add", ({ family, body }) =>
  family
    .addChild(childInput(body["child"]))
    .pipe(Effect.map(({ status, childId }) => ({ ...status, childId }))),
);

const updateChildRoute = parentRoute("/children/update", ({ family, body }) =>
  family.updateChild({ childId: text(body["childId"]), patch: childInput(body["patch"]) }),
);

const removeChildRoute = parentRoute("/children/remove", ({ family, body }) =>
  family.removeChild({ childId: text(body["childId"]) }),
);

/**
 * The child's own look and text size, from Settings › Appearance: picking a look stays open to
 * children (it never changes what SKYCOT does), so this needs no code, and only ever touches the
 * child using SKYCOT on this device.
 */
const lookRoute = route(
  "POST",
  "/look",
  AuthOrchestrationOperateScope,
  ({ family, limits, body, sessionId }) =>
    Effect.gen(function* () {
      const session = yield* limits.forSession({ sessionId });
      if (session.childId === null)
        return json({ error: "invalid-request", message: "Choose who's using SKYCOT first." }, 409);
      const patch: SkycotFamily.ChildInput = {
        ...(typeof body["look"] === "string" ? { look: body["look"] } : {}),
        ...(typeof body["largerText"] === "boolean" ? { largerText: body["largerText"] } : {}),
      };
      return json(yield* family.updateChild({ childId: session.childId, patch }));
    }),
);

const limitRefusal = (refusal: SkycotFamilyLimits.FamilyLimitRefusal) =>
  json(
    {
      error: "asleep",
      message: refusal.sentence,
      requiredPermission: SkycotFamilyGate.FAMILY_ASLEEP_PERMISSION,
    },
    403,
  );

/** "Who's using SKYCOT?" on this device. */
const chooseRoute = route(
  "POST",
  "/choose",
  AuthOrchestrationOperateScope,
  ({ family, limits, body, sessionId }) =>
    Effect.gen(function* () {
      const grownUp = yield* family.allows({ sessionId, purpose: "settings" });
      return yield* limits.choose({ sessionId, childId: text(body["childId"]), grownUp }).pipe(
        Effect.map((session) => json(session)),
        Effect.catchTags({
          SkycotFamilyLimitRefusal: (refusal) => Effect.succeed(limitRefusal(refusal)),
        }),
      );
    }),
);

/** Twice a minute while SKYCOT is open: counts an active minute, answers with today's state. */
const heartbeatRoute = route(
  "POST",
  "/heartbeat",
  AuthOrchestrationOperateScope,
  ({ limits, body, sessionId }) =>
    limits
      .heartbeat({ sessionId, active: body["active"] === true })
      .pipe(Effect.map((session) => json(session))),
);

/** Every child's day (Settings › Family) and who started which conversation. */
const todayRoute = route("GET", "/today", AuthOrchestrationOperateScope, ({ limits }) =>
  limits.today.pipe(Effect.map((today) => json(today))),
);

const MORE_TIME: Readonly<Record<string, SkycotFamilyLimits.MoreTime>> = {
  extra15: { type: "extra", minutes: 15 },
  extra30: { type: "extra", minutes: 30 },
  endBedtime: { type: "endBedtime" },
};

/** "Ask a grown-up for more time": the code goes with the one request; nothing stays open. */
const moreTimeRoute = route(
  "POST",
  "/more-time",
  AuthOrchestrationOperateScope,
  ({ limits, body, sessionId }) =>
    Effect.gen(function* () {
      const more = MORE_TIME[text(body["kind"])];
      if (more === undefined) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      const session = yield* limits.moreTime({
        sessionId,
        childId: text(body["childId"]),
        code: text(body["code"]),
        more,
      });
      return json(session);
    }),
);

/**
 * "Allow Cursor for the Family profile": an assistant SKYCOT can't lock down starts for a child
 * once a grown-up allowed it. The code goes with the one request (counted like every other try);
 * no grant is left open. Codex and Claude are refused: they are locked down already.
 */
const allowAssistantRoute = route(
  "POST",
  "/assistants/allow",
  AuthOrchestrationOperateScope,
  ({ family, body }) =>
    family
      .allowAssistant({ code: text(body["code"]), driver: text(body["driver"]) })
      .pipe(Effect.map((status) => json(status))),
);

/**
 * "Stop allowing": no code, since it only makes the profile stricter (a child pressing it
 * loses nothing a grown-up cannot give back). That assistant's next Family turn is refused.
 */
const stopAllowingAssistantRoute = route(
  "POST",
  "/assistants/stop",
  AuthOrchestrationOperateScope,
  ({ family, body }) =>
    family
      .stopAllowingAssistant({ driver: text(body["driver"]) })
      .pipe(Effect.map((status) => json(status))),
);

const lockRoute = route("POST", "/lock", AuthOrchestrationOperateScope, ({ family, sessionId }) =>
  family.lock({ sessionId }).pipe(
    Effect.andThen(family.status),
    Effect.map((status) => json(status, 200, { "set-cookie": expiredUnlockCookie })),
  ),
);

/**
 * The Family check for the HTTP API routes that change things (`SkycotFamilyGate.
 * isGatedHttpRoute`): a raw POST meets the same rule as the WebSocket call it mirrors. Global
 * router middleware, so no upstream handler changes. Only gated routes are authenticated or
 * have their body read here (the body is cached on the request, so the route reads it again);
 * a request that cannot be authenticated passes through and the route refuses it as before.
 */
export const layerApiGate = HttpRouter.middleware(
  Effect.gen(function* () {
    const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        if (Option.isNone(url)) return yield* httpEffect;
        const pathname = url.value.pathname;
        if (!SkycotFamilyGate.isGatedHttpRoute(request.method, pathname)) return yield* httpEffect;
        const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
        if (Option.isNone(session)) return yield* httpEffect;
        const payload = yield* request.json.pipe(Effect.orElseSucceed(() => null));
        const refusal = yield* gate
          .checkHttp({
            sessionId: session.value.sessionId,
            method: request.method,
            pathname,
            payload,
          })
          .pipe(Effect.flip, Effect.option);
        if (Option.isSome(refusal)) {
          return json(
            {
              error: "family",
              message: refusal.value.message,
              requiredPermission: SkycotFamilyGate.FAMILY_PERMISSION,
            },
            403,
          );
        }
        return yield* httpEffect;
      });
  }),
  { global: true },
);

const SHIELD_CATEGORIES: ReadonlySet<string> = new Set(PERSONAL_CATEGORIES.map((info) => info.id));

/**
 * The composer's shield card showed: noted for the grown-up recap by kind of detail only. The
 * words never come here; anything that is not a known kind is dropped.
 */
const shieldCaughtRoute = route(
  "POST",
  "/shield-caught",
  AuthOrchestrationOperateScope,
  ({ limits, body, sessionId }) =>
    Effect.gen(function* () {
      const categories = Array.isArray(body["categories"])
        ? [...new Set(body["categories"].filter((value) => SHIELD_CATEGORIES.has(String(value))))]
        : [];
      if (categories.length > 0) {
        yield* limits.recordEvent({
          sessionId,
          kind: "shield",
          categories: categories as string[],
        });
      }
      return json({ ok: true });
    }),
);

/** Routes that read what the children made; their services come with this module's layer. */
const madeRoute = (
  method: "GET" | "POST",
  path: string,
  handler: (
    input: Parameters<Handler>[0] & {
      readonly recap: SkycotFamilyRecap.SkycotFamilyRecap["Service"];
      readonly fridge: SkycotFridge.SkycotFridge["Service"];
    },
  ) => ReturnType<Handler>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const recap = yield* SkycotFamilyRecap.SkycotFamilyRecap;
      const fridge = yield* SkycotFridge.SkycotFridge;
      return route(method, path, AuthOrchestrationOperateScope, (input) =>
        handler({ ...input, recap, fridge }),
      );
    }),
  );

/**
 * A child's recap, for a grown-up: the parent code opens it ("recap", ten minutes); the
 * Family settings' own "yes" covers it too, since that one can already change the child.
 */
const recapRoute = madeRoute("GET", "/recap", ({ family, recap, query, sessionId }) =>
  Effect.gen(function* () {
    if (!(yield* family.isEnabled)) {
      return yield* new SkycotFamily.FamilyError({ reason: "not-enabled" });
    }
    const open =
      (yield* family.allows({ sessionId, purpose: "recap" })) ||
      (yield* family.allows({ sessionId, purpose: "settings" }));
    if (!open) return grownUpFirst;
    const range = query.get("range") ?? "week";
    if (!(RECAP_RANGES as ReadonlyArray<string>).includes(range)) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    const report = yield* recap.recap({
      childId: query.get("childId") ?? "",
      range: range as RecapRange,
    });
    if (report === null) return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    return json(report);
  }),
);

/** Everything made here, one magnet per conversation, for the fridge. Open to children. */
const fridgeRoute = madeRoute("GET", "/fridge", ({ fridge }) =>
  fridge.list.pipe(Effect.map((items) => json({ items }))),
);

const fridgePinRoute = madeRoute("POST", "/fridge/pin", ({ fridge, body }) =>
  Effect.gen(function* () {
    const threadId = text(body["threadId"]);
    if (threadId.length === 0) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    const items = yield* fridge.pin({ threadId, pinned: body["pinned"] === true });
    return json({ items });
  }),
);

/**
 * One magnet's page for its thumbnail, with the project's own stylesheets and pictures inside it
 * (the thumbnail frame may not load anything). Only a page that conversation made.
 */
const fridgePageRoute = madeRoute("GET", "/fridge/page", ({ fridge, query }) =>
  Effect.gen(function* () {
    const threadId = query.get("threadId") ?? "";
    const page = query.get("page") ?? "";
    if (threadId.length === 0 || page.length === 0) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    // `html: null`: that conversation never made the page, or it is not there any more.
    return json({ html: yield* fridge.page({ threadId, page }) });
  }),
);

/** The recap and fridge routes, without their services (tests provide stand-ins). */
export const layerMadeRoutes = Layer.mergeAll(
  recapRoute,
  fridgeRoute,
  fridgePinRoute,
  fridgePageRoute,
);

/** The profile's own routes. */
export const layerCore = Layer.mergeAll(
  shieldCaughtRoute,
  statusRoute,
  enableRoute,
  verifyRoute,
  disableRoute,
  changeCodeRoute,
  renameRoute,
  addChildRoute,
  updateChildRoute,
  removeChildRoute,
  lookRoute,
  chooseRoute,
  heartbeatRoute,
  todayRoute,
  moreTimeRoute,
  allowAssistantRoute,
  stopAllowingAssistantRoute,
  lockRoute,
);

/**
 * Every Family route; the recap and the fridge read the engine's projections. SKYCOT's own
 * update routes ride along (`/api/skycot/updates`, with the Family door for restarting), so the
 * engine needs no further wiring line.
 */
export const layer = Layer.mergeAll(
  layerCore,
  SkycotUpdatesHttp.layer,
  layerMadeRoutes.pipe(
    Layer.provide(
      Layer.mergeAll(SkycotFamilyRecap.layer, SkycotFridge.layer).pipe(
        Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
      ),
    ),
  ),
);

const PAGE_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".shtml"]);

/**
 * Whether the static handler (http.ts `handleStaticAndDevRequest`) would answer with a page
 * outside the plain client. Mirrors its resolution rather than guessing from the URL: `/` is
 * `index.html`, a path without an extension is that folder's `index.html`, and anything that
 * is not a real file falls back to the developer interface's `index.html`, whatever its
 * extension (QA FK-02: `/axolotl.png`, `/simple/x`). Only a real non-page file, or a file under
 * `simple/`, is not a developer page; a script or image is inert without the page.
 */
export const servesDeveloperPage = Effect.fn("SkycotFamilyHttp.servesDeveloperPage")(function* (
  staticDir: string,
  pathname: string,
) {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const root = path.resolve(staticDir);
  const relative = path
    .normalize((pathname === "/" ? "/index.html" : pathname).replace(/^[/\\]+/, ""))
    .replace(/^[/\\]+/, "");
  // The handler refuses these with a plain-text 400; redirecting is just as safe.
  if (relative.length === 0 || relative.startsWith("..") || relative.includes("\0")) return true;
  const requested = path.resolve(root, relative);
  const candidate = path.extname(requested) === "" ? path.join(requested, "index.html") : requested;
  if (!candidate.startsWith(`${root}${path.sep}`)) return true;
  const info = yield* fileSystem.stat(candidate).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") return true;
  const served = path.relative(root, candidate).replaceAll("\\", "/");
  if (served.startsWith("simple/")) return false;
  return PAGE_EXTENSIONS.has(path.extname(served).toLowerCase());
});

/**
 * While the Family profile is on, any page outside the plain client (the developer interface and
 * its routes, `/pair` included: the redirect keeps the `#token` fragment) redirects to
 * `/simple/` unless the browser holds a live Advanced-mode unlock cookie. Real assets still
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
  if (config.devUrl || config.staticDir === undefined) return null;
  // Optional so the static route's type (and upstream's tests) stay as they were.
  const familyService = yield* Effect.serviceOption(SkycotFamily.SkycotFamily);
  if (Option.isNone(familyService)) return null;
  const family = familyService.value;
  if (!(yield* family.isEnabled)) return null;
  if (!(yield* servesDeveloperPage(config.staticDir, url.pathname))) return null;
  const cookie = request.cookies[SkycotFamily.UNLOCK_COOKIE_NAME];
  if (yield* family.tokenAllows(cookie, "advanced")) return null;
  return HttpServerResponse.redirect("/simple/", { status: 302, headers: NO_STORE });
});
