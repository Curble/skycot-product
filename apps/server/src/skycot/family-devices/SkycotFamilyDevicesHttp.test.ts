// Who is who over HTTP, through a real server: the doors of the device and approver routes, and
// a child's own device meeting the HTTP reads that name a conversation.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthStandardClientScopes,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/http";

import { deviceSubject } from "@t3tools/skycot-rules/people";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { FRIDGE_FILE_NAME } from "../family-fridge/SkycotFridge.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import * as SkycotFamilyHttp from "../SkycotFamilyHttp.ts";
import * as SkycotFamilyDevices from "./SkycotFamilyDevices.ts";
import * as SkycotFamilyIdentity from "./SkycotFamilyIdentity.ts";
import * as SkycotFamilyVisibility from "./SkycotFamilyVisibility.ts";

const CODE = "482913";
const AVA_IPAD = "d1111111111";
const MUM_PHONE = "d2222222222";

/** Bearer tokens standing for each device's T3 session (subject and scopes as T3 gives them). */
const SESSIONS: Record<
  string,
  {
    readonly sessionId: string;
    readonly subject: string;
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  }
> = {
  "Bearer mac": { sessionId: "mac", subject: "desktop", scopes: AuthStandardClientScopes },
  "Bearer ava": {
    sessionId: "ava-ipad",
    subject: deviceSubject(AVA_IPAD),
    scopes: SkycotFamilyDevices.CHILD_DEVICE_SCOPES,
  },
  "Bearer mum": {
    sessionId: "mum-phone",
    subject: deviceSubject(MUM_PHONE),
    scopes: [AuthOrchestrationReadScope],
  },
};

const makeServer = Effect.fn("WhoIsWhoHttpTest.makeServer")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-who-http-" });
  yield* fs.writeFileString(
    path.join(dir, FRIDGE_FILE_NAME),
    JSON.stringify({ version: 1, pins: {} }),
  );
  const answers: Array<unknown> = [];
  const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
  const layerAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
    authenticateHttpRequest: (request) => {
      const session = SESSIONS[request.headers["authorization"] ?? ""];
      return session === undefined
        ? (Effect.fail({ _tag: "NoCredential" }) as never)
        : Effect.succeed({
            sessionId: AuthSessionId.make(session.sessionId),
            subject: session.subject,
            method: "bearer" as never,
            scopes: session.scopes,
          });
    },
  });
  const layerProjections = Layer.mergeAll(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (threadId) =>
        Effect.succeed(["thread-ava", "thread-leo"].includes(threadId) ? ({} as never) : null),
      getThread: () => Effect.succeed({ projectId: "project-family" } as never),
      getThreadWorktreePaths: () => Effect.succeed([]),
      getTurnItem: () => Effect.succeed(null),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      list: () => Effect.succeed([]),
      get: () => Effect.succeed(Option.none()),
      findActiveByWorkspaceRoot: () => Effect.succeed(Option.none()),
    }),
  );
  const layerGate = SkycotFamilyGate.layerCore.pipe(
    Layer.provideMerge(SkycotFamilyVisibility.layerAt(path.join(dir, FRIDGE_FILE_NAME))),
    Layer.provideMerge(
      SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
    ),
    Layer.provideMerge(
      SkycotFamilyIdentity.layerSubjects(
        Object.fromEntries(
          Object.values(SESSIONS).map((session) => [session.sessionId, session.subject]),
        ),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(layerFamily, layerProjections)),
  );
  const layerDevices = Layer.mock(SkycotFamilyDevices.SkycotFamilyDevices)({
    answer: (input) => {
      answers.push(input);
      return Effect.void;
    },
    approvals: Effect.succeed([]),
    list: Effect.succeed([]),
    endVanished: () => Effect.void,
    endAll: Effect.void,
    watchKeyOptions: () =>
      Effect.succeed({ challenge: "c1", action: "watch-register:d", purpose: "register" as const }),
    watchKeyRegister: (input) => {
      answers.push(input);
      return Effect.succeed({ keyId: "k1" });
    },
    watchChallenge: () =>
      Effect.fail(
        new SkycotFamilyDevices.DevicesError(
          "watch",
          "This phone's Apple Watch isn't set up to say yes.",
        ),
      ),
  });
  // T3's orchestration reads, standing in: the shell and one conversation.
  const layerOrchestration = Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/api/orchestration/shell",
      HttpServerResponse.jsonUnsafe({
        schemaVersion: 1,
        snapshotSequence: 1,
        threads: [
          { id: "thread-ava", projectId: "project-family" },
          { id: "thread-leo", projectId: "project-family" },
        ],
        archivedThreads: [],
        projects: [{ id: "project-family" }],
      }),
    ),
    HttpRouter.add(
      "GET",
      "/api/orchestration/threads/:threadId",
      HttpServerResponse.jsonUnsafe({ ok: true }),
    ),
  );
  const layerApp = Layer.mergeAll(
    SkycotFamilyHttp.layerCore,
    SkycotFamilyHttp.layerDeviceRoutes,
    layerOrchestration,
  ).pipe(
    Layer.provide(SkycotFamilyHttp.layerApiGate),
    Layer.provide(layerDevices),
    Layer.provideMerge(NodeHttpPlatform.layer),
  );
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
  const family = Context.get(services, SkycotFamily.SkycotFamily);
  const limits = Context.get(services, SkycotFamilyLimits.SkycotFamilyLimits);
  const send = (who: string, method: "GET" | "POST", resource: string, body?: unknown) =>
    client
      .execute(
        body === undefined
          ? HttpClientRequest.make(method)(resource, {
              headers: { authorization: `Bearer ${who}` },
            })
          : HttpClientRequest.make(method)(resource, {
              headers: { authorization: `Bearer ${who}` },
            }).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.map((json) => ({
              status: response.status,
              json: json as Record<string, unknown>,
            })),
          ),
        ),
      );
  // The family: Ava and Leo, Mum, Ava's iPad and Mum's phone linked; Ava and Leo's own work.
  const status = yield* family.enable({ code: CODE, childName: "Ava" });
  const avaId = status.children[0]!.id;
  const leoId = (yield* family.addChild({ name: "Leo" })).childId;
  yield* family.addDevice({
    id: AVA_IPAD,
    kind: "child",
    personId: avaId,
    name: "Ava's iPad",
    linkId: "l1",
    linkExpiresAt: 4_102_444_800_000,
  });
  yield* family.addDevice({
    id: MUM_PHONE,
    kind: "grown-up",
    personId: status.grownUps[0]!.id,
    name: "Mum's phone",
    linkId: "l2",
    linkExpiresAt: 4_102_444_800_000,
  });
  yield* limits.choose({ sessionId: "mac", childId: leoId, grownUp: false });
  yield* limits.recordStart({ sessionId: "mac", threadId: "thread-leo" });
  yield* limits.recordStart({ sessionId: "ava-ipad", threadId: "thread-ava" });
  return { send, answers, avaId };
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "skycot-who-http-config-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("who is who over HTTP", (it) => {
  it.effect("each device learns who it is from the engine", () =>
    Effect.gen(function* () {
      const { send, avaId } = yield* makeServer();
      const mac = yield* send("mac", "GET", "/api/skycot/family");
      assert.equal((mac.json["me"] as { kind: string }).kind, "shared");
      const ava = yield* send("ava", "GET", "/api/skycot/family");
      assert.deepEqual(
        { ...(ava.json["me"] as object), deviceName: undefined },
        {
          kind: "child",
          deviceId: AVA_IPAD,
          deviceName: undefined,
          childId: avaId,
          permissions: [],
        },
      );
      // A grown-up's phone holds only T3's read scope, and can still read the profile.
      const mum = yield* send("mum", "GET", "/api/skycot/family");
      assert.equal(mum.status, 200);
      assert.deepEqual((mum.json["me"] as { permissions: Array<string> }).permissions, [
        "family:approver",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("a grown-up's phone may accept or decline only, and nothing else may answer", () =>
    Effect.gen(function* () {
      const { send, answers } = yield* makeServer();
      const body = (decision: string) => ({
        threadId: "thread-ava",
        requestId: "req-1",
        decision,
        fingerprint: "f",
        proof: { type: "code", code: CODE },
      });
      for (const decision of ["acceptForSession", "acceptAlways", "cancel"]) {
        const refused = yield* send(
          "mum",
          "POST",
          "/api/skycot/family/approver/answer",
          body(decision),
        );
        assert.equal(refused.status, 400, decision);
      }
      assert.equal(answers.length, 0);
      const yes = yield* send("mum", "POST", "/api/skycot/family/approver/answer", body("accept"));
      assert.equal(yes.status, 200);
      assert.equal(answers.length, 1);
      // The Mac and a child's iPad are not approver devices.
      assert.equal(
        (yield* send("mac", "POST", "/api/skycot/family/approver/answer", body("accept"))).status,
        403,
      );
      assert.equal(
        (yield* send("ava", "POST", "/api/skycot/family/approver/answer", body("accept"))).status,
        403,
      );
      assert.equal(answers.length, 1);
      // The phone can't change the profile, choose a child or open Files.
      assert.equal(
        (yield* send("mum", "POST", "/api/skycot/family/children/add", { child: { name: "X" } }))
          .status,
        403,
      );
      assert.equal(
        (yield* send("mum", "POST", "/api/skycot/family/verify", {
          code: CODE,
          purpose: "settings",
        })).status,
        403,
      );
      assert.equal((yield* send("mum", "GET", "/api/skycot/files/list?projectId=p")).status, 403);
      // Managing devices happens on the Mac, with the parent code.
      assert.equal((yield* send("mum", "GET", "/api/skycot/family/devices")).status, 403);
      assert.equal(
        (yield* send("ava", "POST", "/api/skycot/family/devices/link", {
          kind: "child",
          personId: "x",
        })).status,
        403,
      );
      const macWithoutCode = yield* send("mac", "POST", "/api/skycot/family/devices/link", {
        kind: "child",
        personId: "x",
      });
      assert.equal(macWithoutCode.status, 403);
      assert.equal(macWithoutCode.json["requiredPermission"], SkycotFamilyGate.FAMILY_PERMISSION);
    }).pipe(Effect.scoped),
  );

  it.effect("only a grown-up's phone may set up its Watch or ask for a Watch's challenge", () =>
    Effect.gen(function* () {
      const { send, answers } = yield* makeServer();
      const options = "/api/skycot/family/approver/watch/options";
      const challenge = "/api/skycot/family/approver/watch/challenge";
      const register = "/api/skycot/family/approver/watch/register";
      const card = { threadId: "thread-ava", requestId: "req-1", fingerprint: "f" };
      for (const who of ["ava", "mac"]) {
        assert.equal((yield* send(who, "POST", options, { code: CODE })).status, 403, who);
        assert.equal((yield* send(who, "POST", challenge, card)).status, 403, who);
      }
      const opened = yield* send("mum", "POST", options, { code: CODE });
      assert.equal(opened.json["purpose"], "register");
      assert.equal((yield* send("mum", "POST", challenge, card)).json["error"], "watch");
      // Where the key lives is one of three labels, or the request isn't understood.
      const unknown = yield* send("mum", "POST", register, {
        challenge: "c1",
        publicKey: "x",
        signature: "y",
        protection: "trust-me",
      });
      assert.equal(unknown.json["error"], "invalid-request");
      assert.equal(answers.length, 0);
      const added = yield* send("mum", "POST", register, {
        challenge: "c1",
        publicKey: "x",
        signature: "y",
        name: "Mum's Apple Watch",
        protection: "secure-enclave",
      });
      assert.equal(added.json["keyId"], "k1");
      assert.deepInclude(answers[0] as object, { name: "Mum's Apple Watch", challenge: "c1" });
    }).pipe(Effect.scoped),
  );

  it.effect("a child's iPad reads only its own conversation, and its shell arrives filtered", () =>
    Effect.gen(function* () {
      const { send } = yield* makeServer();
      assert.equal(
        (yield* send("ava", "GET", "/api/orchestration/threads/thread-ava")).status,
        200,
      );
      assert.equal(
        (yield* send("ava", "GET", "/api/orchestration/threads/thread-leo")).status,
        403,
      );
      assert.equal(
        (yield* send("mac", "GET", "/api/orchestration/threads/thread-leo")).status,
        200,
      );
      const shell = yield* send("ava", "GET", "/api/orchestration/shell");
      assert.deepEqual(
        (shell.json["threads"] as Array<{ id: string }>).map((thread) => thread.id),
        ["thread-ava"],
      );
      const all = yield* send("mac", "GET", "/api/orchestration/shell");
      assert.equal((all.json["threads"] as Array<unknown>).length, 2);
      // Who started what: only her own.
      const today = yield* send("ava", "GET", "/api/skycot/family/today");
      assert.deepEqual(Object.keys(today.json["threads"] as object), ["thread-ava"]);
      // No Advanced mode on a child's device, even with the code.
      const advanced = yield* send("ava", "POST", "/api/skycot/family/verify", {
        code: CODE,
        purpose: "advanced",
      });
      assert.equal(advanced.status, 403);
    }).pipe(Effect.scoped),
  );
});
