// The Family routes and the developer-interface page gate, through a real HTTP server.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthStandardClientScopes,
  CommandId,
  EnvironmentAuthorizationError,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2RpcSchemas,
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  RpcScopeAuthorization,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";
import * as Socket from "effect/socket/Socket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerHttp from "../http.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkycotFridge from "./family-fridge/SkycotFridge.ts";
import * as SkycotFamilyLimits from "./family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamilyRecap from "./family-recap/SkycotFamilyRecap.ts";
import * as SkycotFamily from "./SkycotFamily.ts";
import * as SkycotFamilyGate from "./SkycotFamilyGate.ts";
import * as SkycotFamilyHttp from "./SkycotFamilyHttp.ts";

const CODE = "482913";
const BEARER = "Bearer parent-device";

const makeClient = Effect.fn("SkycotFamilyHttpTest.makeClient")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-http-" });
  const staticDir = path.join(dir, "client");
  yield* fs.makeDirectory(path.join(staticDir, "simple"), { recursive: true });
  yield* fs.makeDirectory(path.join(staticDir, "assets"), { recursive: true });
  yield* fs.writeFileString(path.join(staticDir, "assets", "index-abc12345.js"), "// bundle");
  yield* fs.writeFileString(path.join(staticDir, "index.html"), "<p>developer interface</p>");
  yield* fs.writeFileString(path.join(staticDir, "simple", "index.html"), "<p>SKYCOT</p>");
  const pinned: Array<unknown> = [];

  const layerDependencies = Layer.mergeAll(
    SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)).pipe(
      Layer.provideMerge(SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME))),
    ),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      authenticateHttpRequest: (request) =>
        request.headers["authorization"] === BEARER
          ? Effect.succeed({
              sessionId: AuthSessionId.make("session-parent"),
              subject: "parent",
              method: "bearer" as never,
              scopes: AuthStandardClientScopes,
            })
          : (Effect.fail({ _tag: "NoCredential" }) as never),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      updateSettings: (patch) => {
        pinned.push(patch);
        return Effect.succeed({} as never);
      },
    }),
  );
  const pins: Array<unknown> = [];
  // Stand-ins: the recap and fridge contents have their own tests; these check the doors.
  const layerMade = SkycotFamilyHttp.layerMadeRoutes.pipe(
    Layer.provide(
      Layer.merge(
        Layer.mock(SkycotFamilyRecap.SkycotFamilyRecap)({
          recap: ({ childId, range }) =>
            Effect.succeed(childId === "nobody" ? null : ({ childId, range } as never)),
        }),
        Layer.mock(SkycotFridge.SkycotFridge)({
          list: Effect.succeed([]),
          pin: (input) => {
            pins.push(input);
            return Effect.succeed([]);
          },
        }),
      ),
    ),
  );
  const layerApp = Layer.mergeAll(
    SkycotFamilyHttp.layerCore,
    layerMade,
    ServerHttp.layerStaticAndDevRoute,
  ).pipe(Layer.provideMerge(NodeHttpPlatform.layer));
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(layerDependencies),
      Layer.provideMerge(ServerConfig.layer({ ...config, staticDir, devUrl: undefined })),
      Layer.provideMerge(Layer.succeed(FileSystem.FileSystem, fs)),
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  const send = (
    method: "GET" | "POST",
    resource: string,
    options: { readonly body?: unknown; readonly headers?: Record<string, string> } = {},
  ) =>
    client.execute(
      options.body === undefined
        ? HttpClientRequest.make(method)(resource, {
            headers: { authorization: BEARER, ...options.headers },
          })
        : HttpClientRequest.make(method)(resource, {
            headers: { authorization: BEARER, ...options.headers },
          }).pipe(HttpClientRequest.bodyJsonUnsafe(options.body)),
    );
  return { send, pinned, pins };
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "skycot-family-http-config-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("Family profile over HTTP", (it) => {
  it.effect(
    "turns on, refuses a wrong code in plain words, and locks the developer interface",
    () =>
      Effect.gen(function* () {
        const { send, pinned } = yield* makeClient();
        const before = yield* send("GET", "/api/skycot/family");
        assert.equal(before.status, 200);
        assert.equal(((yield* before.json) as { enabled: boolean }).enabled, false);
        assert.equal((yield* send("GET", "/")).status, 200);

        const on = yield* send("POST", "/api/skycot/family/enable", {
          body: { code: CODE, childName: "Ava" },
        });
        assert.equal(on.status, 200);
        assert.deepEqual(pinned, [{ defaultRuntimeMode: "approval-required" }]);

        // The test client follows the redirect, so the page that comes back is the plain one.
        const root = yield* send("GET", "/");
        assert.equal(root.status, 200);
        const rootText = yield* root.text;
        assert.include(rootText, "SKYCOT");
        assert.notInclude(rootText, "developer interface");
        const settingsRoute = yield* send("GET", "/settings");
        assert.notInclude(yield* settingsRoute.text, "developer interface");
        assert.equal((yield* send("GET", "/simple/")).status, 200);
        // QA FK-02: any address the single-page-app fallback answers is the developer page.
        for (const resource of [
          "/axolotl.png",
          "/a.json",
          "/foo.html",
          "/settings/general.x",
          "/%2e%2e/",
          "/assets%2Findex-abc12345.js",
          "/simple/x",
          "/simple/x.png",
        ]) {
          const page = yield* send("GET", resource, { headers: { accept: "text/html" } });
          const pageText = yield* page.text;
          assert.notInclude(pageText, "developer interface", resource);
          assert.include(pageText, "SKYCOT", resource);
        }
        const asset = yield* send("GET", "/assets/index-abc12345.js");
        assert.equal(asset.status, 200);
        assert.equal(yield* asset.text, "// bundle");

        const wrong = yield* send("POST", "/api/skycot/family/verify", {
          body: { code: "000000", purpose: "advanced" },
        });
        // QA FK-14: an expected answer, not a failed request.
        assert.equal(wrong.status, 200);
        const body = (yield* wrong.json) as {
          error: string;
          message: string;
          attemptsLeft: number;
        };
        assert.equal(body.error, "wrong-code");
        assert.equal(body.attemptsLeft, 4);
        assert.match(body.message, /not the parent code/);
      }),
  );

  it.effect("the parent code opens the developer interface with an HttpOnly cookie", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      yield* send("POST", "/api/skycot/family/enable", { body: { code: CODE, childName: null } });
      const unlock = yield* send("POST", "/api/skycot/family/verify", {
        body: { code: CODE, purpose: "advanced" },
      });
      assert.equal(unlock.status, 200);
      const cookie = unlock.headers["set-cookie"];
      const header = Array.isArray(cookie) ? cookie[0]! : String(cookie);
      assert.include(header, `${SkycotFamily.UNLOCK_COOKIE_NAME}=`);
      assert.include(header, "HttpOnly");
      const pair = header.split(";")[0]!;
      const page = yield* send("GET", "/", { headers: { cookie: pair } });
      assert.equal(page.status, 200);
      assert.include(yield* page.text, "developer interface");
      // QA FK-16: Settings can say Advanced mode is open, and for how long.
      const status = (yield* (yield* send("GET", "/api/skycot/family")).json) as {
        grants: ReadonlyArray<{ purpose: string; remainingMs: number }>;
      };
      assert.deepEqual(
        status.grants.map((grant) => grant.purpose),
        ["advanced"],
      );
      assert.isAbove(status.grants[0]!.remainingMs, 14 * 60_000);
      yield* send("POST", "/api/skycot/family/lock", { body: {} });
      const locked = (yield* (yield* send("GET", "/api/skycot/family")).json) as {
        grants: ReadonlyArray<unknown>;
      };
      assert.deepEqual(locked.grants, []);
    }),
  );

  it.effect("shows a child's recap only after the parent code; the fridge stays open", () =>
    Effect.gen(function* () {
      const { send, pins } = yield* makeClient();
      const status = (yield* (yield* send("POST", "/api/skycot/family/enable", {
        body: { code: CODE, childName: "Ava" },
      })).json) as { children: ReadonlyArray<{ id: string }> };
      const ava = status.children[0]!.id;
      const resource = `/api/skycot/family/recap?childId=${ava}&range=week`;
      const refused = yield* send("GET", resource);
      assert.equal(refused.status, 403);
      assert.equal(
        ((yield* refused.json) as { requiredPermission: string }).requiredPermission,
        SkycotFamilyGate.FAMILY_PERMISSION,
      );
      const unlock = yield* send("POST", "/api/skycot/family/verify", {
        body: { code: CODE, purpose: "recap" },
      });
      assert.equal(unlock.status, 200);
      const report = yield* send("GET", resource);
      assert.equal(report.status, 200);
      assert.deepEqual(yield* report.json, { childId: ava, range: "week" });
      assert.equal((yield* send("GET", `${resource.replace("week", "year")}`)).status, 400);
      assert.equal(
        (yield* send("GET", "/api/skycot/family/recap?childId=nobody&range=session")).status,
        400,
      );
      // Children pin and take down magnets freely.
      yield* send("POST", "/api/skycot/family/lock", { body: {} });
      assert.equal((yield* send("GET", "/api/skycot/family/fridge")).status, 200);
      const pinned = yield* send("POST", "/api/skycot/family/fridge/pin", {
        body: { threadId: "thread:space", pinned: true },
      });
      assert.equal(pinned.status, 200);
      assert.deepEqual(pins, [{ threadId: "thread:space", pinned: true }]);
    }),
  );

  // QA FK-10: the child could rename themselves without the code.
  it.effect("renames the child only after a grown-up's yes", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      yield* send("POST", "/api/skycot/family/enable", { body: { code: CODE, childName: "Ava" } });
      const refused = yield* send("POST", "/api/skycot/family/rename", {
        body: { childName: "Boss" },
      });
      assert.equal(refused.status, 403);
      const status = yield* send("GET", "/api/skycot/family");
      assert.equal(((yield* status.json) as { childName: string }).childName, "Ava");
      yield* send("POST", "/api/skycot/family/verify", {
        body: { code: CODE, purpose: "settings" },
      });
      const renamed = yield* send("POST", "/api/skycot/family/rename", {
        body: { childName: "Ava B" },
      });
      assert.equal(renamed.status, 200);
      assert.equal(((yield* renamed.json) as { childName: string }).childName, "Ava B");
    }),
  );

  it.effect("allows an assistant only with the parent code; stopping needs none", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      const post = (resource: string, body: unknown) =>
        send("POST", `/api/skycot/family${resource}`, { body }).pipe(
          Effect.flatMap((response) =>
            response.json.pipe(
              Effect.map((json) => ({
                status: response.status,
                json: json as Record<string, any>,
              })),
            ),
          ),
        );
      yield* post("/enable", { code: CODE, childName: "Ava" });
      const wrong = yield* post("/assistants/allow", { driver: "cursor", code: "000000" });
      assert.equal(wrong.json["error"], "wrong-code");
      assert.equal(wrong.json["attemptsLeft"], SkycotFamily.MAX_ATTEMPTS - 1);
      const codex = yield* post("/assistants/allow", { driver: "codex", code: CODE });
      assert.equal(codex.status, 400);
      const allowed = yield* post("/assistants/allow", { driver: "cursor", code: CODE });
      assert.equal(allowed.status, 200);
      assert.deepEqual(allowed.json["allowedAssistants"], ["cursor"]);
      const status = (yield* (yield* send("GET", "/api/skycot/family")).json) as Record<
        string,
        any
      >;
      assert.deepEqual(status["allowedAssistants"], ["cursor"]);
      // No grant is left open by allowing: the code went with that one request.
      assert.deepEqual(status["grants"], []);
      const stopped = yield* post("/assistants/stop", { driver: "cursor" });
      assert.equal(stopped.status, 200);
      assert.deepEqual(stopped.json["allowedAssistants"], []);
    }),
  );

  it.effect("keeps several children: changes need a grown-up's yes, choosing does not", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      const post = (resource: string, body: unknown) =>
        send("POST", `/api/skycot/family${resource}`, { body }).pipe(
          Effect.flatMap((response) =>
            response.json.pipe(
              Effect.map((json) => ({
                status: response.status,
                json: json as Record<string, any>,
              })),
            ),
          ),
        );
      yield* post("/enable", { code: CODE, childName: "Ava", timeZone: "Australia/Melbourne" });
      const refused = yield* post("/children/add", { child: { name: "Leo" } });
      assert.equal(refused.status, 403);
      assert.equal(refused.json["requiredPermission"], SkycotFamilyGate.FAMILY_PERMISSION);

      yield* post("/verify", { code: CODE, purpose: "settings" });
      const added = yield* post("/children/add", { child: { name: "Leo" } });
      assert.equal(added.status, 200);
      assert.lengthOf(added.json["children"], 2);
      const leo = added.json["childId"] as string;
      const limited = yield* post("/children/update", {
        childId: leo,
        patch: { limits: { dailyTurns: 20 } },
      });
      assert.equal(limited.json["children"][1].limits.dailyTurns, 20);

      const status = (yield* (yield* send("GET", "/api/skycot/family")).json) as Record<
        string,
        any
      >;
      assert.isTrue(status["session"].needsChoice);
      const chosen = yield* post("/choose", { childId: leo });
      assert.equal(chosen.json["childId"], leo);
      assert.equal(chosen.json["limits"].turns, 0);
      const beat = yield* post("/heartbeat", { active: true });
      assert.equal(beat.json["limits"].usedMinutes, 1);

      // The child's own look needs no code, and only touches the child using this device.
      const look = yield* post("/look", { look: "classic", largerText: false });
      assert.equal(look.json["children"][1].look, "classic");
      assert.equal(look.json["children"][0].look, SkycotFamily.DEFAULT_LOOK);

      const wrong = yield* post("/more-time", { childId: leo, kind: "extra15", code: "000000" });
      assert.equal(wrong.json["error"], "wrong-code");
      const more = yield* post("/more-time", { childId: leo, kind: "extra30", code: CODE });
      assert.equal(more.json["limits"].passUntil > 0, true);
      const today = (yield* (yield* send("GET", "/api/skycot/family/today")).json) as Record<
        string,
        any
      >;
      assert.equal(today["children"][1].moreTime[0].minutes, 30);
    }),
  );

  it.effect("refuses a device that is not signed in", () =>
    Effect.gen(function* () {
      const { send } = yield* makeClient();
      const response = yield* send("POST", "/api/skycot/family/enable", {
        body: { code: CODE, childName: null },
        headers: { authorization: "Bearer stranger" },
      });
      assert.equal(response.status, 401);
    }),
  );
});

// The engine end of a grown-up card and of the HTTP twins of gated calls: a real server, a real
// WebSocket RPC client, the real gate and middleware. Only the routes behind them are stubs.
const RespondRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: EnvironmentAuthorizationError,
});
const RespondGroup = RpcGroup.make(RespondRpc).middleware(RpcScopeAuthorization);
const THREAD_ID = ThreadId.make("thread:family-http");
const REQUEST_ID = RuntimeRequestId.make("req-install");
const ROOT = "/Users/kid/projects/space-game";
const NOW = DateTime.makeUnsafe("2026-10-22T09:00:00.000Z");
const nativeItemRef = {
  driver: ProviderDriverKind.make("codex"),
  nativeId: "tool-1",
  strength: "strong" as const,
};
const itemBase = {
  threadId: THREAD_ID,
  runId: null,
  nodeId: "node:approval" as never,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef,
  parentItemId: null,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: NOW,
};
/** The card B4c held: an install that also reaches the internet. */
const heldItems: ReadonlyArray<OrchestrationV2TurnItem> = [
  {
    ...itemBase,
    id: IdAllocator.derive.approvalTurnItem({ requestId: REQUEST_ID }),
    ordinal: 1,
    status: "waiting",
    type: "approval_request",
    requestId: REQUEST_ID,
    requestKind: "command",
    prompt: "npm install phaser",
  },
  {
    ...itemBase,
    id: IdAllocator.derive.turnItemFromProviderItem({
      driver: nativeItemRef.driver,
      nativeItemId: nativeItemRef.nativeId,
    }),
    ordinal: 0,
    status: "running",
    type: "command_execution",
    input: "npm install phaser",
  },
];

const makeEngine = Effect.fn("SkycotFamilyHttpTest.makeEngine")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-family-engine-" });
  let dispatched = 0;
  const layerAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
    authenticateHttpRequest: (request) =>
      request.headers["authorization"] === BEARER
        ? Effect.succeed({
            sessionId: AuthSessionId.make("session-parent"),
            subject: "parent",
            method: "bearer" as never,
            scopes: AuthStandardClientScopes,
          })
        : (Effect.fail({ _tag: "NoCredential" }) as never),
  });
  const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
  const layerGate = SkycotFamilyGate.layer.pipe(
    Layer.provideMerge(layerFamily),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: () =>
            Effect.succeed({ projectId: "project:family", worktreePath: ROOT } as never),
          getTurnItem: ({ itemId }) =>
            Effect.succeed(heldItems.find((item) => item.id === itemId) ?? null),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeed(Option.none()),
          findActiveByWorkspaceRoot: () => Effect.succeed(Option.none()),
        }),
        // The children's Questions spaces are not exercised here.
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          scratchRoot: Effect.succeedNone,
          namedProjectsRoot: ROOT,
        }),
        Layer.mock(ProjectService.ProjectService)({}),
      ),
    ),
  );
  // The socket's session, as ws.ts gives it after authenticating the upgrade.
  const layerWs = HttpRouter.add(
    "GET",
    "/ws",
    Effect.gen(function* () {
      const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
      return yield* RpcServer.toHttpEffectWebsocket(RespondGroup).pipe(
        Effect.provide(
          Layer.mergeAll(
            RespondGroup.toLayer({
              [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: () =>
                Effect.sync(() => {
                  dispatched += 1;
                  return { sequence: dispatched };
                }),
            }),
            SkycotFamilyGate.layerRpcAuthorization(gate, "session-parent", "parent").pipe(
              Layer.provide(Layer.succeed(RpcScopeAuthorization)((effect) => effect)),
            ),
            RpcSerialization.layerJson,
          ),
        ),
      );
    }).pipe(Effect.flatten),
  );
  const layerPairing = HttpRouter.add(
    "POST",
    "/api/auth/pairing-token",
    HttpServerResponse.jsonUnsafe({ credential: "pairing-link" }),
  );
  // Echoes its body: the gate reads it first, and the route must still get it whole.
  const layerMutate = HttpRouter.add(
    "POST",
    "/api/projects/mutate",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return HttpServerResponse.jsonUnsafe(yield* request.json);
    }),
  );
  const layerApp = Layer.mergeAll(
    SkycotFamilyHttp.layerCore,
    layerWs,
    layerPairing,
    layerMutate,
  ).pipe(Layer.provide(SkycotFamilyHttp.layerApiGate), Layer.provideMerge(NodeHttpPlatform.layer));
  const services = yield* Layer.build(
    HttpRouter.serve(layerApp, { disableListenLog: true }).pipe(
      Layer.provideMerge(layerGate),
      Layer.provideMerge(layerAuth),
      Layer.provideMerge(
        Layer.mock(ServerSettings.ServerSettingsService)({
          updateSettings: () => Effect.succeed({} as never),
        }),
      ),
      Layer.provideMerge(ServerConfig.layer({ ...config, devUrl: undefined })),
      Layer.provideMerge(Layer.succeed(FileSystem.FileSystem, fs)),
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const client = Context.get(services, HttpClient.HttpClient);
  const address = Context.get(services, HttpServer.HttpServer).address;
  const port = "port" in address ? address.port : 0;
  const post = (resource: string, body: unknown) =>
    client.execute(
      HttpClientRequest.post(resource, { headers: { authorization: BEARER } }).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    );
  /**
   * The child's "Allow" over a real WebSocket. Opened only by the test that needs it, and
   * before any HTTP request: the socket's handshake shares the fetch client's connections.
   * Built in the caller's scope; a protocol provided only to `make` would close with it.
   */
  const connectAllow = Effect.fn("SkycotFamilyHttpTest.connectAllow")(function* () {
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`)),
        Layer.provide(NodeSocket.layerWebSocketConstructor),
        Layer.provide(RpcSerialization.layerJson),
      ),
    );
    const rpc = yield* RpcClient.make(RespondGroup).pipe(Effect.provide(protocol));
    return rpc[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
      type: "runtime-request.respond",
      commandId: CommandId.make("command:allow"),
      threadId: THREAD_ID,
      requestId: REQUEST_ID,
      decision: "accept",
    });
  });
  return { post, connectAllow, dispatchedCount: () => dispatched };
});

const layerEngineEnvironment = ServerConfig.layerTest(process.cwd(), {
  prefix: "skycot-family-engine-config-",
}).pipe(Layer.provideMerge(NodeServices.layer));

// Live clock: the WebSocket client's open and ping timers run on it.
it.live(
  "refuses a child's Allow on a grown-up card over the socket until the code is entered",
  () =>
    Effect.gen(function* () {
      const { post, connectAllow, dispatchedCount } = yield* makeEngine();
      const allow = yield* connectAllow();
      // Off: the card is the child's to answer.
      assert.equal((yield* allow).sequence, 1);
      assert.equal(
        (yield* post("/api/skycot/family/enable", { code: CODE, childName: null })).status,
        200,
      );

      const refusal = yield* Effect.flip(allow);
      assert.equal(
        refusal._tag === "EnvironmentAuthorizationError"
          ? refusal.requiredPermission
          : refusal._tag,
        SkycotFamilyGate.FAMILY_PERMISSION,
      );
      assert.equal(dispatchedCount(), 1);

      // A wrong code opens nothing; the right one opens this card once.
      const wrong = yield* post("/api/skycot/family/verify", {
        code: "000000",
        purpose: "approve",
        requestId: REQUEST_ID,
      });
      assert.equal(((yield* wrong.json) as { error: string }).error, "wrong-code");
      assert.isTrue(Exit.isFailure(yield* Effect.exit(allow)));
      const right = yield* post("/api/skycot/family/verify", {
        code: CODE,
        purpose: "approve",
        requestId: REQUEST_ID,
      });
      assert.equal(right.status, 200);
      assert.equal((yield* allow).sequence, 2);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(allow)));
      assert.equal(dispatchedCount(), 2);
    }).pipe(Effect.scoped, Effect.provide(layerEngineEnvironment)),
);

it.layer(layerEngineEnvironment)("Family profile at the engine's doors", (it) => {
  it.effect("holds the HTTP twins of gated calls for the code", () =>
    Effect.gen(function* () {
      const { post } = yield* makeEngine();
      assert.equal((yield* post("/api/auth/pairing-token", {})).status, 200);
      yield* post("/api/skycot/family/enable", { code: CODE, childName: null });
      const held = yield* post("/api/auth/pairing-token", {});
      assert.equal(held.status, 403);
      const body = (yield* held.json) as { error: string; requiredPermission: string };
      assert.equal(body.error, "family");
      assert.equal(body.requiredPermission, SkycotFamilyGate.FAMILY_PERMISSION);
      // A rename stays open, and the route still reads the body the gate already read.
      const rename = { type: "project.update", projectId: "project:1", title: "Rocket club" };
      const renamed = yield* post("/api/projects/mutate", rename);
      assert.equal(renamed.status, 200);
      assert.deepEqual(yield* renamed.json, rename);
      assert.equal((yield* post("/api/projects/mutate", { type: "project.create" })).status, 403);
      yield* post("/api/skycot/family/verify", { code: CODE, purpose: "advanced" });
      const minted = yield* post("/api/auth/pairing-token", {});
      assert.equal(minted.status, 200);
      assert.deepEqual(yield* minted.json, { credential: "pairing-link" });
    }).pipe(Effect.scoped),
  );
});
