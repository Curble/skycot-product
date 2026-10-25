// HTTP transport for the Family profile: `/api/skycot/family/*`, authenticated with the same
// session (cookie or bearer) as every other `/api` route. Each handler decodes, calls one
// SkycotFamily method and maps its error to a plain JSON answer the client shows as it is.
// Also the developer-interface page gate the static handler calls (one seam in http.ts).

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
} from "@t3tools/contracts";
import type { AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { PERSONAL_CATEGORIES } from "@t3tools/skycot-rules/personal";
import { FAMILY_APPROVER_PERMISSION, type FamilyIdentity } from "@t3tools/skycot-rules/people";

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
import * as SkycotFamilyDevices from "./family-devices/SkycotFamilyDevices.ts";
import * as SkycotFamilyIdentity from "./family-devices/SkycotFamilyIdentity.ts";
import * as SkycotFamilyVisibility from "./family-devices/SkycotFamilyVisibility.ts";
import * as SkycotFamilyNotes from "./family-notes/SkycotFamilyNotes.ts";
import { grownUpAnswersFor } from "./family-limits/grownUpAnswers.ts";
import * as SkycotRelay from "./relay/SkycotRelay.ts";
import { deviceGate, isWatchedPath } from "./family-devices/httpVisibility.ts";
import {
  isApproverDecision,
  isDeviceKeyBiometry,
  isWatchKeyProtection,
  type DeviceKind,
} from "@t3tools/skycot-rules/people";

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
  /** Who this device is (the Mac, a child's own device, a grown-up's device). */
  readonly who: FamilyIdentity;
  /** The device service, when the server has one (tests without it skip device work). */
  readonly devices: Option.Option<SkycotFamilyDevices.SkycotFamilyDevices["Service"]>;
  /** The child view on a child's own device, for answers that list everyone's work. */
  readonly childView: SkycotFamilyVisibility.ChildView | null;
  readonly request: HttpServerRequest.HttpServerRequest;
  /** SKYCOT Relay, when the server has it. */
  readonly relay: Option.Option<SkycotRelay.SkycotRelay["Service"]>;
  readonly notes: Option.Option<SkycotFamilyNotes.SkycotFamilyNotes["Service"]>;
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
      const identities = yield* Effect.serviceOption(SkycotFamilyIdentity.SkycotFamilyIdentity);
      const visibility = yield* Effect.serviceOption(SkycotFamilyVisibility.SkycotFamilyVisibility);
      const devices = yield* Effect.serviceOption(SkycotFamilyDevices.SkycotFamilyDevices);
      const relay = yield* Effect.serviceOption(SkycotRelay.SkycotRelay);
      const notes = yield* Effect.serviceOption(SkycotFamilyNotes.SkycotFamilyNotes);
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
          const who: FamilyIdentity = Option.isSome(identities)
            ? yield* identities.value.identifySession(session)
            : { kind: "shared" };
          if (who.kind === "removed") {
            return json(
              {
                error: "removed",
                message: SkycotFamilyGate.REMOVED_DEVICE_MESSAGE,
                requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
              },
              403,
            );
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
          const childView =
            who.kind === "child" && Option.isSome(visibility)
              ? yield* visibility.value.childViewFor(session.sessionId)
              : null;
          return yield* handler({
            sessionId: session.sessionId,
            body,
            query: Option.isSome(url) ? url.value.searchParams : new URLSearchParams(),
            family,
            limits,
            pinSafeDefault,
            who,
            devices,
            childView,
            request,
            relay,
            notes,
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
 * How many digits the parent code has, for the code box to take it on the last digit (like the
 * iPhone's lock screen). Only the family's Mac and grown-ups' devices are told: a child's own
 * device is not, and nobody is ever sent the code itself. Unknown (`null`) means the button.
 */
export const codeLengthFor = (
  family: SkycotFamily.SkycotFamily["Service"],
  who: FamilyIdentity,
): Effect.Effect<{ readonly codeLength?: number | null }> =>
  who.kind === "grown-up" || who.kind === "shared"
    ? family.codeLength.pipe(Effect.map((codeLength) => ({ codeLength })))
    : Effect.succeed({});

/**
 * The profile, plus what a grown-up has opened on this device and for how long, and who is
 * using SKYCOT here (with whether it is awake for them).
 */
const statusRoute = route(
  "GET",
  "",
  AuthOrchestrationReadScope,
  ({ family, limits, sessionId, who }) =>
    Effect.gen(function* () {
      const status = yield* family.status;
      const grants = yield* family.openGrants({ sessionId });
      const session = yield* limits.forSession({ sessionId });
      const length = yield* codeLengthFor(family, who);
      return json({ ...status, ...length, grants, session, me: meOf(who) });
    }),
);

/** Who this device is, for the screens (and a future phone app): never more than the engine decided. */
export function meOf(who: FamilyIdentity) {
  switch (who.kind) {
    case "child":
      return {
        kind: "child" as const,
        deviceId: who.deviceId,
        deviceName: who.deviceName,
        childId: who.childId,
        permissions: [],
      };
    case "grown-up":
      return {
        kind: "grown-up" as const,
        deviceId: who.deviceId,
        deviceName: who.deviceName,
        personId: who.personId,
        permissions: [FAMILY_APPROVER_PERMISSION],
      };
    default:
      return { kind: "shared" as const, permissions: [] };
  }
}

const enableRoute = route(
  "POST",
  "/enable",
  AuthSettingsWriteScope,
  ({ family, body, pinSafeDefault, who }) =>
    Effect.gen(function* () {
      const status = yield* family.enable({
        code: text(body["code"]),
        childName: nullableText(body["childName"]),
        timeZone: nullableText(body["timeZone"]),
      });
      yield* pinSafeDefault;
      return json({ ...status, ...(yield* codeLengthFor(family, who)) });
    }),
);

const verifyRoute = route(
  "POST",
  "/verify",
  AuthOrchestrationOperateScope,
  ({ family, body, sessionId, who }) =>
    Effect.gen(function* () {
      const purpose = text(body["purpose"]) as SkycotFamily.FamilyPurpose;
      const requestId = nullableText(body["requestId"]) ?? undefined;
      if (who.kind === "child" && purpose === "advanced") {
        return json(
          {
            error: "forbidden",
            message: "Advanced mode is only on the family's Mac.",
            requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
          },
          403,
        );
      }
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

const disableRoute = route(
  "POST",
  "/disable",
  AuthSettingsWriteScope,
  ({ family, body, devices }) =>
    family.disable({ code: text(body["code"]) }).pipe(
      // Off forgets every linked device: their sign-ins end too.
      Effect.tap(() => (Option.isSome(devices) ? devices.value.endAll : Effect.void)),
      Effect.map((status) => json(status, 200, { "set-cookie": expiredUnlockCookie })),
    ),
);

const changeCodeRoute = route(
  "POST",
  "/change-code",
  AuthSettingsWriteScope,
  ({ family, body, devices, who }) =>
    Effect.gen(function* () {
      const before = yield* family.status;
      const status = yield* family.changeCode({
        oldCode: text(body["oldCode"]),
        newCode: text(body["newCode"]),
      });
      // A new code unlinks grown-ups' devices: their sign-ins end now.
      if (Option.isSome(devices)) yield* devices.value.endVanished(before);
      // The new code's length at once: a box still counting the old one would send it too soon.
      return json({ ...status, ...(yield* codeLengthFor(family, who)) }, 200, {
        "set-cookie": expiredUnlockCookie,
      });
    }),
);

const deviceRefused = json(
  {
    error: "forbidden",
    message: SkycotFamilyGate.CHILD_DEVICE_MESSAGE,
    requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
  },
  403,
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
  route("POST", path, AuthOrchestrationOperateScope, ({ family, body, sessionId, devices }) =>
    Effect.gen(function* () {
      if (!(yield* settingsOpen(family, sessionId))) return grownUpFirst;
      const timeZone = nullableText(body["timeZone"]);
      if (timeZone !== null) yield* family.setTimeZone(timeZone);
      const before = yield* family.status;
      const answer = yield* run({ family, body });
      // A child removed takes their devices with them: those sign-ins end now.
      if (Option.isSome(devices)) yield* devices.value.endVanished(before);
      return json(answer);
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
    ...("askEachStep" in input ? { askEachStep: input["askEachStep"] } : {}),
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
          SkycotFamilyLimitRefusal: (refusal) =>
            Effect.succeed(
              refusal.reason === "device"
                ? json(
                    {
                      error: "forbidden",
                      message: refusal.sentence,
                      requiredPermission: SkycotFamilyGate.FAMILY_PERMISSION,
                    },
                    403,
                  )
                : limitRefusal(refusal),
            ),
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
const todayRoute = route("GET", "/today", AuthOrchestrationReadScope, ({ limits, childView }) =>
  limits.today.pipe(
    Effect.map((today) =>
      json(
        childView === null
          ? today
          : {
              ...today,
              // A child's own device learns who started their own work only.
              threads: ownOnly(today.threads, childView.childId),
              projects: ownOnly(today.projects, childView.childId),
            },
      ),
    ),
  ),
);

const ownOnly = (owners: Readonly<Record<string, string>>, childId: string) =>
  Object.fromEntries(Object.entries(owners).filter(([, owner]) => owner === childId));

/**
 * The model switches in one conversation (model-fallback), for its plain "… is resting, so …"
 * lines. Read scope, like the conversation itself; works with the profile off too. A child's own
 * device only reads its own conversations.
 */
const assistantSwitchesRoute = route(
  "GET",
  "/assistant-switches",
  AuthOrchestrationReadScope,
  ({ limits, query, childView }) =>
    Effect.gen(function* () {
      const threadId = query.get("threadId") ?? "";
      if (threadId.length === 0) return json({ switches: [] });
      if (childView !== null) {
        const today = yield* limits.today;
        if (today.threads[threadId] !== childView.childId) return json({ switches: [] });
      }
      return json({ switches: yield* limits.switchesFor(threadId) });
    }),
);

/**
 * Who answered the held requests in one conversation ("Mum said yes · 8:42"). A child gets only
 * their own conversations' answers, as a first name and a time (grownUpAnswers.ts).
 */
const grownUpAnswersRoute = route(
  "GET",
  "/grown-up-answers",
  AuthOrchestrationReadScope,
  ({ limits, query, childView, family }) =>
    Effect.gen(function* () {
      const threadId = query.get("threadId") ?? "";
      if (threadId.length === 0) return json({ answers: [] });
      if (childView !== null) {
        const today = yield* limits.today;
        if (today.threads[threadId] !== childView.childId) return json({ answers: [] });
      }
      const snapshot = yield* limits.snapshot;
      if (snapshot === null) return json({ answers: [] });
      const status = yield* family.status;
      return json({
        answers: grownUpAnswersFor(snapshot.activity.events, threadId, status.grownUps),
      });
    }),
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

/**
 * "Let this page use the internet": a grown-up lets one of the child's pages load pictures,
 * sounds and data from the named sites (https only, never scripts). The code goes with the one
 * request, counted like every other try; the engine remembers the yes for that page.
 */
const allowPageInternetRoute = route(
  "POST",
  "/page-internet/allow",
  AuthOrchestrationOperateScope,
  ({ family, body }) =>
    family
      .allowPageInternet({
        code: text(body["code"]),
        page: text(body["page"]),
        sites: Array.isArray(body["sites"]) ? body["sites"] : [],
      })
      .pipe(Effect.map((status) => json(status))),
);

/** Takes a page's internet back: no code, since it only makes the profile stricter. */
const stopPageInternetRoute = route(
  "POST",
  "/page-internet/stop",
  AuthOrchestrationOperateScope,
  ({ family, body }) =>
    family
      .stopPageInternet({ page: text(body["page"]) })
      .pipe(Effect.map((status) => json(status))),
);

/**
 * "Trusted add-ons download by themselves": the parent's switch, either way with the code (one
 * try, counted like every other). The engine keeps it; nothing stays open.
 */
const trustedAddOnsRoute = route(
  "POST",
  "/trusted-add-ons",
  AuthOrchestrationOperateScope,
  ({ family, body }) =>
    typeof body["on"] !== "boolean"
      ? Effect.fail(new SkycotFamily.FamilyError({ reason: "invalid-request" }))
      : family
          .setTrustedAddOns({ code: text(body["code"]), on: body["on"] })
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
    // Who is who: optional so a router built without them (older tests) behaves as before.
    const identities = yield* Effect.serviceOption(SkycotFamilyIdentity.SkycotFamilyIdentity);
    const visibility = yield* Effect.serviceOption(SkycotFamilyVisibility.SkycotFamilyVisibility);
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        if (Option.isNone(url)) return yield* httpEffect;
        const pathname = url.value.pathname;
        const gated = SkycotFamilyGate.isGatedHttpRoute(request.method, pathname);
        const watched = Option.isSome(identities) && isWatchedPath(pathname);
        if (!gated && !watched) return yield* httpEffect;
        const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
        if (Option.isNone(session)) return yield* httpEffect;
        let transform:
          | ((
              response: HttpServerResponse.HttpServerResponse,
            ) => Effect.Effect<HttpServerResponse.HttpServerResponse>)
          | undefined;
        if (watched && Option.isSome(identities)) {
          const who = yield* identities.value.identifySession(session.value);
          const decision = yield* deviceGate({
            method: request.method,
            pathname,
            query: url.value.searchParams,
            body: request.json.pipe(Effect.orElseSucceed(() => null)),
            who,
            sessionId: session.value.sessionId,
            visibility: Option.getOrNull(visibility),
          });
          if (decision.type === "refuse") return decision.response;
          transform = decision.transform;
        }
        if (gated) {
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
        }
        const response = yield* httpEffect;
        return transform === undefined ? response : yield* transform(response);
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
      return route(
        method,
        path,
        method === "GET" ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope,
        (input) => handler({ ...input, recap, fridge }),
      );
    }),
  );

/**
 * A child's recap, for a grown-up: the parent code opens it ("recap", ten minutes); the
 * Family settings' own "yes" covers it too, since that one can already change the child.
 */
const recapRoute = madeRoute("GET", "/recap", ({ family, recap, query, sessionId, who }) =>
  Effect.gen(function* () {
    if (!(yield* family.isEnabled)) {
      return yield* new SkycotFamily.FamilyError({ reason: "not-enabled" });
    }
    // A grown-up's own device is the grown-up: it reads the recap without the code.
    const open =
      who.kind === "grown-up" ||
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
const fridgeRoute = madeRoute("GET", "/fridge", ({ fridge, childView }) =>
  fridge.list.pipe(
    Effect.map((items) =>
      json({
        // A child's own device: their own magnets, and whatever the family pinned.
        items:
          childView === null
            ? items
            : items.filter((item) => item.childId === childView.childId || item.pinnedAt !== null),
      }),
    ),
  ),
);

const fridgePinRoute = madeRoute("POST", "/fridge/pin", ({ fridge, body, childView }) =>
  Effect.gen(function* () {
    const threadId = text(body["threadId"]);
    if (threadId.length === 0) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    // A child's own device pins and takes down only their own magnets.
    if (childView !== null && childView.owners.threads[threadId] !== childView.childId) {
      return deviceRefused;
    }
    const items = yield* fridge.pin({ threadId, pinned: body["pinned"] === true });
    return json({ items });
  }),
);

/**
 * One magnet's page for its thumbnail, with the project's own stylesheets and pictures inside it
 * (the thumbnail frame may not load anything). Only a page that conversation made.
 */
// nondev-seam: skycot-playable-copy
const fridgePlayRoute = madeRoute("GET", "/fridge/play", ({ fridge, query, childView, family }) =>
  Effect.gen(function* () {
    const threadId = query.get("threadId") ?? "";
    const page = query.get("page") ?? "";
    if (!threadId || !page || !/\.html?$/iu.test(page))
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    if (
      childView !== null &&
      childView.owners.threads[threadId] !== childView.childId &&
      !childView.pinned.has(threadId)
    )
      return deviceRefused;
    // Sites are keyed by the canonical path on this Mac; an unapproved page stays offline.
    return json(yield* fridge.playable({ threadId, page, sitesForPage: family.pageInternetSites }));
  }),
);

// nondev-seam: skycot-page-internet-ask-route
const pageInternetAskRoute = madeRoute(
  "POST",
  "/page-internet/ask",
  ({ body, childView, family, fridge, limits, sessionId, who }) =>
    Effect.gen(function* () {
      const threadId = text(body["threadId"]);
      const requestedPage = text(body["page"]);
      const sites = Array.isArray(body["sites"]) ? body["sites"] : [];
      if (
        (who.kind !== "child" && who.kind !== "shared") ||
        threadId.length === 0 ||
        requestedPage.length === 0
      ) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      const childId =
        who.kind === "child" ? who.childId : (yield* limits.forSession({ sessionId })).childId;
      if (childId === null)
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      const owner = childView?.owners.threads[threadId] ?? (yield* limits.today).threads[threadId];
      if (owner !== childId || (childView !== null && childView.childId !== childId)) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      const page = yield* fridge.pagePath({ threadId, page: requestedPage });
      if (page === null) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      return json({
        ask: yield* family.askPageInternet({
          threadId,
          childId,
          page,
          sites: sites as string[],
        }),
      });
    }),
);

const fridgePageRoute = madeRoute("GET", "/fridge/page", ({ fridge, query, childView }) =>
  Effect.gen(function* () {
    const threadId = query.get("threadId") ?? "";
    const page = query.get("page") ?? "";
    if (threadId.length === 0 || page.length === 0) {
      return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
    }
    if (
      childView !== null &&
      childView.owners.threads[threadId] !== childView.childId &&
      !childView.pinned.has(threadId)
    ) {
      return deviceRefused;
    }
    // `html: null`: that conversation never made the page, or it is not there any more.
    return json({ html: yield* fridge.page({ threadId, page }) });
  }),
);

// People and devices ("who is who", Phase 1). Managing them is a grown-up's job on the family's
// Mac (the Family settings' yes); a grown-up's own device answers requests through the approver
// routes below and can unlink itself. The device service does the work; these are the doors.

const devicesMissing = json(
  { error: "unavailable", message: "Linking devices isn't available on this Mac." },
  503,
);

const deviceFailure = (error: SkycotFamilyDevices.DevicesError) =>
  json({ error: error.reason, message: error.message }, error.reason === "not-allowed" ? 403 : 200);

const onlyOnTheMac = json(
  {
    error: "forbidden",
    message: "People and devices are managed on the family's Mac.",
    requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
  },
  403,
);

const onlyGrownUpDevices = json(
  {
    error: "forbidden",
    message: "This is for a grown-up's own device.",
    requiredPermission: SkycotFamilyGate.FAMILY_DEVICE_PERMISSION,
  },
  403,
);

/** A route for managing people and devices: the Mac only, with the Family settings' yes. */
const managerRoute = (
  method: "GET" | "POST",
  path: string,
  run: (
    input: Parameters<Handler>[0] & {
      readonly service: SkycotFamilyDevices.SkycotFamilyDevices["Service"];
    },
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    SkycotFamily.FamilyError | SkycotFamilyDevices.DevicesError
  >,
) =>
  route(
    method,
    path,
    method === "GET" ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope,
    (input) =>
      Effect.gen(function* () {
        if (Option.isNone(input.devices)) return devicesMissing;
        if (input.who.kind !== "shared") return onlyOnTheMac;
        if (method === "POST" && !(yield* settingsOpen(input.family, input.sessionId))) {
          return grownUpFirst;
        }
        return yield* run({ ...input, service: input.devices.value }).pipe(
          Effect.catchIf(
            (error): error is SkycotFamilyDevices.DevicesError =>
              error instanceof SkycotFamilyDevices.DevicesError,
            (error) => Effect.succeed(deviceFailure(error)),
          ),
        );
      }),
  );

/** Every linked device with its person, kind and when it was last seen. */
const devicesListRoute = managerRoute("GET", "/devices", ({ service }) =>
  service.list.pipe(Effect.map((devices) => json({ devices }))),
);

// nondev-seam: skycot-family-link-addresses
const deviceLinkAddressesRoute = managerRoute(
  "GET",
  "/devices/link-addresses",
  ({ service, request }) =>
    service.linkAddresses(originOf(request)).pipe(Effect.map((addresses) => json({ addresses }))),
);

/**
 * "Link a device": a one-time link for one person, as T3's pairing link (single use, five
 * minutes, the code after the "#" so it never reaches a server log).
 */
const devicesLinkRoute = managerRoute(
  "POST",
  "/devices/link",
  ({ service, body, request, relay }) =>
    Effect.gen(function* () {
      const kind =
        body["kind"] === "child" || body["kind"] === "grown-up"
          ? (body["kind"] as DeviceKind)
          : null;
      const personId = text(body["personId"]);
      if (kind === null || personId.length === 0) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      const link = yield* service.createLink({ kind, personId, name: nullableText(body["name"]) });
      const bases = yield* service.linkAddresses(originOf(request));
      // With SKYCOT Relay on, the first link works from anywhere: the same one-time code, plus
      // what the device needs to find this Mac through the relay (all after the "#").
      const viaRelay = Option.isSome(relay)
        ? yield* relay.value.linkFor(link.deviceId)
        : Option.none();
      return json({
        ...link,
        links: [
          ...(Option.isSome(viaRelay)
            ? [
                {
                  label: "Anywhere (SKYCOT Relay)",
                  reachable: viaRelay.value.connected,
                  url: `${viaRelay.value.appUrl}/simple/#${new URLSearchParams([
                    ["token", link.code],
                    ...viaRelay.value.params,
                  ]).toString()}`,
                },
              ]
            : []),
          ...bases.map((entry) => ({
            label: entry.label,
            reachable: entry.reachable,
            url: `${entry.base}/simple/#${new URLSearchParams([["token", link.code]]).toString()}`,
          })),
        ],
      });
    }),
);

const devicesRemoveRoute = managerRoute("POST", "/devices/remove", ({ service, body, relay }) =>
  service.remove(text(body["deviceId"])).pipe(
    // Its relay pass stops working too, and any tunnel it has open closes now.
    Effect.andThen(Option.isSome(relay) ? relay.value.forgetVanished : Effect.void),
    Effect.andThen(service.list),
    Effect.map((devices) => json({ devices })),
  ),
);

const personInput = (value: unknown): SkycotFamily.PersonInput => {
  const input = record(value);
  return {
    ...("name" in input ? { name: nullableText(input["name"]) } : {}),
    ...("avatar" in input ? { avatar: input["avatar"] } : {}),
  };
};

const peopleAddRoute = managerRoute("POST", "/people/add", ({ family, body }) =>
  family
    .addGrownUp(personInput(body["person"]))
    .pipe(Effect.map(({ status, personId }) => json({ ...status, personId }))),
);

const peopleUpdateRoute = managerRoute("POST", "/people/update", ({ family, body }) =>
  family
    .updateGrownUp({ personId: text(body["personId"]), patch: personInput(body["patch"]) })
    .pipe(Effect.map((status) => json(status))),
);

const peopleRemoveRoute = managerRoute(
  "POST",
  "/people/remove",
  ({ family, body, service, relay }) =>
    Effect.gen(function* () {
      const before = yield* family.status;
      const status = yield* family.removeGrownUp({ personId: text(body["personId"]) });
      // Their devices go with them: those sign-ins end now, and their relay passes.
      yield* service.endVanished(before);
      if (Option.isSome(relay)) yield* relay.value.forgetVanished;
      return json(status);
    }),
);

/** A route only a grown-up's own device may use. */
const approverRoute = (
  method: "GET" | "POST",
  path: string,
  run: (
    input: Parameters<Handler>[0] & {
      readonly service: SkycotFamilyDevices.SkycotFamilyDevices["Service"];
      readonly grownUp: Extract<FamilyIdentity, { kind: "grown-up" }>;
      readonly origin: string;
    },
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    SkycotFamily.FamilyError | SkycotFamilyDevices.DevicesError
  >,
) =>
  route(method, path, AuthOrchestrationReadScope, (input) =>
    Effect.gen(function* () {
      if (Option.isNone(input.devices)) return devicesMissing;
      if (input.who.kind !== "grown-up") return onlyGrownUpDevices;
      if (!(yield* input.family.isEnabled)) {
        return yield* new SkycotFamily.FamilyError({ reason: "not-enabled" });
      }
      return yield* run({
        ...input,
        service: input.devices.value,
        grownUp: input.who,
        origin: originOf(input.request) ?? "",
      }).pipe(
        Effect.catchIf(
          (error): error is SkycotFamilyDevices.DevicesError =>
            error instanceof SkycotFamilyDevices.DevicesError,
          (error) => Effect.succeed(deviceFailure(error)),
        ),
      );
    }),
  );

const proofOf = (value: unknown): SkycotFamilyDevices.Proof | null => {
  const input = record(value);
  if (input["type"] === "code") return { type: "code", code: text(input["code"]) };
  if (input["type"] === "passkey") {
    return {
      type: "passkey",
      credentialId: text(input["credentialId"]),
      response: input["response"],
      challenge: text(input["challenge"]),
    };
  }
  if (input["type"] === "watch" || input["type"] === "device-key") {
    return {
      type: input["type"],
      keyId: text(input["keyId"]),
      challenge: text(input["challenge"]),
      signature: text(input["signature"]),
    };
  }
  return null;
};

/** The requests waiting for a grown-up, in plain words (details only after the phone is unlocked). */
const approverRequestsRoute = approverRoute("GET", "/approver/requests", ({ service }) =>
  service.approvals.pipe(Effect.map((requests) => json({ requests }))),
);

/** A child can leave only a small note for their own grown-ups; the relay gets only its kind. */
const childNotesRoute = route(
  "GET",
  "/notes/child",
  AuthOrchestrationReadScope,
  ({ who, sessionId, limits, notes }) =>
    Effect.gen(function* () {
      const childId =
        who.kind === "child"
          ? who.childId
          : who.kind === "shared"
            ? (yield* limits.forSession({ sessionId })).childId
            : null;
      if (childId === null) return json({ error: "forbidden" }, 403);
      if (Option.isNone(notes)) return json({ notes: [] });
      return json({ notes: yield* notes.value.own(childId) });
    }),
);

const childNoteCreateRoute = route(
  "POST",
  "/notes/child",
  AuthOrchestrationOperateScope,
  ({ who, sessionId, body, family, limits, notes, relay }) =>
    Effect.gen(function* () {
      const childId =
        who.kind === "child"
          ? who.childId
          : who.kind === "shared"
            ? (yield* limits.forSession({ sessionId })).childId
            : null;
      if (childId === null) return json({ error: "forbidden" }, 403);
      if (Option.isNone(notes)) return json({ error: "unavailable" }, 503);
      const kind = body["kind"];
      if (kind !== "shown" && kind !== "more-time") return json({ error: "invalid-request" }, 400);
      const status = yield* family.status;
      if (!status.enabled || !status.children.some((child) => child.id === childId))
        return json({ error: "not-enabled" }, 409);
      if (
        kind === "shown" &&
        (typeof body["threadId"] !== "string" || typeof body["title"] !== "string")
      )
        return json({ error: "invalid-request" }, 400);
      if (kind === "shown" && (yield* limits.today).threads[text(body["threadId"])] !== childId)
        return json({ error: "forbidden" }, 403);
      const repeat = (yield* notes.value.own(childId)).find((note) =>
        SkycotFamilyNotes.sameOpenNote(note, {
          kind,
          childId,
          ...(kind === "shown" ? { threadId: text(body["threadId"]) } : {}),
        }),
      );
      if (repeat !== undefined) return json({ note: repeat });
      const note = yield* notes.value.create({
        kind,
        childId,
        ...(kind === "shown"
          ? { threadId: text(body["threadId"]), title: text(body["title"]) }
          : {}),
      });
      if (Option.isSome(relay)) {
        const adults = status.devices
          .filter((device) => device.kind === "grown-up")
          .map((device) => device.id);
        yield* relay.value
          .notify({ familyDeviceIds: adults, kind: "family-note" })
          .pipe(Effect.ignore);
      }
      return json({ note }, 201);
    }),
);

/** Requests at the top of a grown-up's inbox. Child identities never enter these handlers. */
const familyNotesRoute = approverRoute("GET", "/approver/notes", ({ notes }) =>
  Option.isSome(notes)
    ? notes.value.open.pipe(Effect.map((notes) => json({ notes })))
    : Effect.succeed(json({ notes: [] })),
);

const familyNoteSeenRoute = approverRoute("POST", "/approver/notes/seen", ({ notes, body }) =>
  Option.isSome(notes)
    ? notes.value.seen(text(body["id"])).pipe(Effect.map((ok) => json({ ok })))
    : Effect.succeed(json({ error: "unavailable" }, 503)),
);

const familyNoteAnswerRoute = approverRoute(
  "POST",
  "/approver/notes/answer",
  ({ notes, body, grownUp, family, service, sessionId, origin }) =>
    Effect.gen(function* () {
      if (Option.isNone(notes)) return json({ error: "unavailable" }, 503);
      const id = text(body["id"]);
      const minutes = body["minutes"];
      if (minutes !== 0 && minutes !== 15 && minutes !== 30)
        return json({ error: "invalid-request" }, 400);
      const match = (yield* notes.value.open).find(
        (note) => note.id === id && note.kind === "more-time",
      );
      if (match === undefined || match.kind !== "more-time") return json({ error: "gone" }, 409);
      if (minutes !== 0) {
        yield* service.moreTime({
          who: grownUp,
          sessionId,
          origin,
          childId: match.childId,
          kind: minutes === 15 ? "extra15" : "extra30",
          proof: proofOf(body["proof"]),
        });
      }
      const person = (yield* family.status).grownUps.find((entry) => entry.id === grownUp.personId);
      const answer = yield* notes.value.answer({ id, minutes, by: person?.name ?? "A grown-up" });
      return answer === null ? json({ error: "gone" }, 409) : json({ note: answer });
    }),
);

/** A passkey challenge for one yes, or for more time. */
const approverChallengeRoute = approverRoute(
  "POST",
  "/approver/challenge",
  ({ service, grownUp, origin, body }) =>
    Effect.gen(function* () {
      const action =
        body["type"] === "more-time"
          ? {
              type: "more-time" as const,
              childId: text(body["childId"]),
              kind: text(body["kind"]),
            }
          : {
              type: "approve" as const,
              threadId: text(body["threadId"]),
              requestId: text(body["requestId"]),
              fingerprint: text(body["fingerprint"]),
            };
      return json(yield* service.challenge({ who: grownUp, origin, action }));
    }),
);

/** Accept or decline one request, once. Never "for the session" or "always". */
const approverAnswerRoute = approverRoute(
  "POST",
  "/approver/answer",
  ({ service, grownUp, origin, body, sessionId }) =>
    Effect.gen(function* () {
      const decision = body["decision"];
      if (!isApproverDecision(decision)) {
        return json(
          {
            error: "invalid-request",
            message: "A grown-up's device can say yes once, or no. Nothing else.",
          },
          400,
        );
      }
      yield* service.answer({
        who: grownUp,
        sessionId,
        origin,
        threadId: text(body["threadId"]),
        requestId: text(body["requestId"]),
        decision,
        fingerprint: text(body["fingerprint"]),
        proof: proofOf(body["proof"]),
        via: body["via"] === "watch" ? "watch" : null,
      });
      return json({ ok: true });
    }),
);

const approverMoreTimeRoute = approverRoute(
  "POST",
  "/approver/more-time",
  ({ service, grownUp, origin, body, sessionId }) =>
    service
      .moreTime({
        who: grownUp,
        sessionId,
        origin,
        childId: text(body["childId"]),
        kind: text(body["kind"]),
        proof: proofOf(body["proof"]),
      })
      .pipe(Effect.as(json({ ok: true }))),
);

/** "Lock everything": ends every grown-up's yes on every device. No proof: it only takes away. */
const approverLockAllRoute = approverRoute("POST", "/approver/lock-all", ({ family }) =>
  family.lockAll.pipe(Effect.as(json({ ok: true }))),
);

/** Setting up Face ID on this grown-up's device: the parent code once. */
const passkeyOptionsRoute = approverRoute(
  "POST",
  "/devices/passkey/options",
  ({ service, grownUp, origin, body }) =>
    service
      .passkeyOptions({ who: grownUp, origin, code: text(body["code"]) })
      .pipe(Effect.map((options) => json(options))),
);

const passkeyRegisterRoute = approverRoute(
  "POST",
  "/devices/passkey/register",
  ({ service, grownUp, origin, body }) =>
    service
      .passkeyRegister({
        who: grownUp,
        origin,
        challenge: text(body["challenge"]),
        response: body["response"],
      })
      .pipe(Effect.as(json({ ok: true }))),
);

const passkeyForgetRoute = approverRoute(
  "POST",
  "/devices/passkey/forget",
  ({ service, grownUp }) => service.passkeyForget(grownUp).pipe(Effect.as(json({ ok: true }))),
);

/**
 * "Say yes from my Apple Watch" (Phase 4): the phone asks with the parent code once, carries
 * the challenge to its Watch, and brings back the Watch's public key and its signature over the
 * challenge. The Watch's key never leaves the Watch.
 */
const watchOptionsRoute = approverRoute(
  "POST",
  "/approver/watch/options",
  ({ service, grownUp, body }) =>
    service
      .watchKeyOptions({ who: grownUp, code: text(body["code"]) })
      .pipe(Effect.map((options) => json(options))),
);

const watchRegisterRoute = approverRoute(
  "POST",
  "/approver/watch/register",
  ({ service, grownUp, body }) =>
    Effect.gen(function* () {
      const protection = body["protection"];
      if (!isWatchKeyProtection(protection)) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      return json(
        yield* service.watchKeyRegister({
          who: grownUp,
          challenge: text(body["challenge"]),
          publicKey: text(body["publicKey"]),
          signature: text(body["signature"]),
          name: nullableText(body["name"]),
          protection,
        }),
      );
    }),
);

/** "Stop saying yes from the Watch": it only takes away, so no proof. */
const watchForgetRoute = approverRoute("POST", "/approver/watch/forget", ({ service, grownUp }) =>
  service.watchKeyForget(grownUp).pipe(Effect.as(json({ ok: true }))),
);

/** A challenge for one yes from the Watch, for the card the Watch is showing. */
const watchChallengeRoute = approverRoute(
  "POST",
  "/approver/watch/challenge",
  ({ service, grownUp, body }) =>
    service
      .watchChallenge({
        who: grownUp,
        threadId: text(body["threadId"]),
        requestId: text(body["requestId"]),
        fingerprint: text(body["fingerprint"]),
      })
      .pipe(Effect.map((issued) => json(issued))),
);

/**
 * "Use Face ID to say yes" on a grown-up's own iPhone: the phone asks with the parent code once,
 * makes its key in the Secure Enclave and brings back the public half with a Face ID signature
 * over the challenge. The private key never leaves the phone's Secure Enclave.
 */
const deviceKeyOptionsRoute = approverRoute(
  "POST",
  "/approver/device-key/options",
  ({ service, grownUp, body }) =>
    service
      .deviceKeyOptions({ who: grownUp, code: text(body["code"]) })
      .pipe(Effect.map((options) => json(options))),
);

const deviceKeyRegisterRoute = approverRoute(
  "POST",
  "/approver/device-key/register",
  ({ service, grownUp, body }) =>
    Effect.gen(function* () {
      const biometry = body["biometry"];
      if (!isDeviceKeyBiometry(biometry)) {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      return json(
        yield* service.deviceKeyRegister({
          who: grownUp,
          challenge: text(body["challenge"]),
          publicKey: text(body["publicKey"]),
          signature: text(body["signature"]),
          biometry,
        }),
      );
    }),
);

/** "Stop using Face ID": it only takes away, so no proof. */
const deviceKeyForgetRoute = approverRoute(
  "POST",
  "/approver/device-key/forget",
  ({ service, grownUp }) => service.deviceKeyForget(grownUp).pipe(Effect.as(json({ ok: true }))),
);

/** A challenge for one yes with this device's Face ID key, for the card it shows. */
const deviceKeyChallengeRoute = approverRoute(
  "POST",
  "/approver/device-key/challenge",
  ({ service, grownUp, body }) =>
    service
      .deviceKeyChallenge({
        who: grownUp,
        threadId: text(body["threadId"]),
        requestId: text(body["requestId"]),
        fingerprint: text(body["fingerprint"]),
      })
      .pipe(Effect.map((issued) => json(issued))),
);

/** "Unlink this device", from the grown-up's device itself: it only takes away. */
const unlinkSelfRoute = approverRoute("POST", "/devices/unlink-self", ({ service, grownUp }) =>
  service.remove(grownUp.deviceId).pipe(Effect.as(json({ ok: true }))),
);

const relayMissing = json(
  { error: "unavailable", message: "SKYCOT Relay isn't part of this Mac's SKYCOT." },
  503,
);

/**
 * "Reach this Mac from anywhere": SKYCOT Relay's status, on the family's Mac only. Linked devices
 * use the relay; they never manage it.
 */
const relayStatusRoute = route("GET", "/relay", AuthOrchestrationReadScope, ({ who, relay }) =>
  Effect.gen(function* () {
    if (who.kind !== "shared") return onlyOnTheMac;
    if (Option.isNone(relay)) return relayMissing;
    return json(yield* relay.value.status);
  }),
);

/** Turning the relay on or off: the Mac, with the Family settings' yes (the parent code). */
const relaySetRoute = route(
  "POST",
  "/relay",
  AuthOrchestrationOperateScope,
  ({ who, relay, family, sessionId, body }) =>
    Effect.gen(function* () {
      if (who.kind !== "shared") return onlyOnTheMac;
      if (Option.isNone(relay)) return relayMissing;
      if (!(yield* family.isEnabled)) {
        return json(
          {
            error: "not-enabled",
            message: "Turn on the Family profile first: the relay is for linked devices.",
          },
          409,
        );
      }
      if (!(yield* family.allows({ sessionId, purpose: "settings" }))) return grownUpFirst;
      if (typeof body["enabled"] !== "boolean") {
        return yield* new SkycotFamily.FamilyError({ reason: "invalid-request" });
      }
      return json(yield* relay.value.setEnabled(body["enabled"]));
    }),
);

/** People and devices. */
export const layerDeviceRoutes = Layer.mergeAll(
  relayStatusRoute,
  relaySetRoute,
  devicesListRoute,
  deviceLinkAddressesRoute,
  devicesLinkRoute,
  devicesRemoveRoute,
  peopleAddRoute,
  peopleUpdateRoute,
  peopleRemoveRoute,
  approverRequestsRoute,
  childNotesRoute,
  childNoteCreateRoute,
  familyNotesRoute,
  familyNoteSeenRoute,
  familyNoteAnswerRoute,
  approverChallengeRoute,
  approverAnswerRoute,
  approverMoreTimeRoute,
  approverLockAllRoute,
  passkeyOptionsRoute,
  passkeyRegisterRoute,
  passkeyForgetRoute,
  watchOptionsRoute,
  watchRegisterRoute,
  watchForgetRoute,
  watchChallengeRoute,
  deviceKeyOptionsRoute,
  deviceKeyRegisterRoute,
  deviceKeyForgetRoute,
  deviceKeyChallengeRoute,
  unlinkSelfRoute,
);

/** The page's origin, for passkeys (the browser sends it with every POST) and for links. */
function originOf(request: HttpServerRequest.HttpServerRequest): string | null {
  const origin = request.headers["origin"];
  if (typeof origin === "string" && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const host = request.headers["host"];
  if (typeof host !== "string" || host.length === 0) return null;
  const proto = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

/** The recap and fridge routes, without their services (tests provide stand-ins). */
export const layerMadeRoutes = Layer.mergeAll(
  recapRoute,
  fridgeRoute,
  // nondev-seam: skycot-playable-copy
  fridgePlayRoute,
  pageInternetAskRoute,
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
  assistantSwitchesRoute,
  grownUpAnswersRoute,
  moreTimeRoute,
  allowAssistantRoute,
  stopAllowingAssistantRoute,
  allowPageInternetRoute,
  stopPageInternetRoute,
  trustedAddOnsRoute,
  lockRoute,
);

/**
 * Every Family route; the recap and the fridge read the engine's projections. SKYCOT's own
 * update routes ride along (`/api/skycot/updates`, with the Family door for restarting), so the
 * engine needs no further wiring line.
 */
export const layer = Layer.mergeAll(
  layerCore,
  layerDeviceRoutes,
  SkycotUpdatesHttp.layer,
  layerMadeRoutes.pipe(
    Layer.provide(
      Layer.mergeAll(SkycotFamilyRecap.layer, SkycotFridge.layer).pipe(
        Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
      ),
    ),
  ),
).pipe(
  // SKYCOT Relay rides along here too (off until a grown-up turns it on): no wiring line in
  // upstream's server.ts.
  Layer.provide(SkycotRelay.layer),
  Layer.provide(SkycotFamilyNotes.layer),
  Layer.provide(
    SkycotFamilyDevices.layer.pipe(
      Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
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
