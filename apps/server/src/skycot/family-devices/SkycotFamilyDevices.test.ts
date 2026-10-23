// Test fixtures use loose stand-ins on purpose.
// @effect-diagnostics anyUnknownInErrorContext:off
// @effect-diagnostics unsafeEffectTypeAssertion:off
// Who is who (Phase 1), end to end inside the engine: a child's iPad and a grown-up's phone
// linked to people in a real Family profile, judged by the real gate, limits and visibility over
// stand-in projections. The sign-in itself is T3's and has its own tests; here a session's
// subject is what T3 would have given the device.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  type AuthSessionId,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellStreamItem,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { deviceSubject } from "@t3tools/skycot-rules/people";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { FRIDGE_FILE_NAME } from "../family-fridge/SkycotFridge.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import * as SkycotFamilyDevices from "./SkycotFamilyDevices.ts";
import * as SkycotFamilyIdentity from "./SkycotFamilyIdentity.ts";
import * as SkycotFamilyVisibility from "./SkycotFamilyVisibility.ts";
import { filterShellSnapshot, folderOwner, referencedBy } from "./visibility.ts";

const CODE = "482913";
/** A fixed moment for request times and link expiries; tests set the engine's clock to it. */
const EPOCH = Date.UTC(2026, 9, 23, 9, 0, 0);
const AVA_IPAD = "d1111111111";
const MUM_PHONE = "d2222222222";
const GONE_PHONE = "d3333333333";

/** Sessions as T3 would have issued them: the Mac's, Ava's iPad, Mum's phone, a removed phone. */
const SUBJECTS: Record<string, string> = {
  "mac-ava": "desktop",
  "mac-leo": "desktop",
  "ava-ipad": deviceSubject(AVA_IPAD),
  "mum-phone": deviceSubject(MUM_PHONE),
  "gone-phone": deviceSubject(GONE_PHONE),
};

interface FakeThread {
  readonly id: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
}
const THREADS: ReadonlyArray<FakeThread> = [
  { id: "thread-ava", projectId: "project-family", worktreePath: "/w/ava-1" },
  { id: "thread-leo", projectId: "project-family", worktreePath: "/w/leo-1" },
  { id: "thread-leo-pinned", projectId: "project-leo", worktreePath: "/w/leo-2" },
  { id: "thread-old", projectId: "project-family", worktreePath: "/w/old" },
];
const PROJECTS = [
  { projectId: "project-family", workspaceRoot: "/p/family", title: "Family" },
  { projectId: "project-leo", workspaceRoot: "/p/leo", title: "Leo's games" },
];

const shellOf = (thread: FakeThread) =>
  ({
    id: thread.id,
    projectId: thread.projectId,
    title: thread.id,
    worktreePath: thread.worktreePath,
    pendingRuntimeRequest: null,
  }) as never;

interface World {
  readonly gate: SkycotFamilyGate.SkycotFamilyGate["Service"];
  readonly family: SkycotFamily.SkycotFamily["Service"];
  readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
  readonly visibility: SkycotFamilyVisibility.SkycotFamilyVisibility["Service"];
  readonly identity: SkycotFamilyIdentity.SkycotFamilyIdentity["Service"];
  readonly avaId: string;
  readonly leoId: string;
  readonly mumId: string;
}

/** A Family with Ava and Leo, Mum's phone and Ava's iPad linked, and some work already made. */
const withWorld = <A, E, R>(
  use: (world: World) => Effect.Effect<A, E, R>,
  options: { readonly on?: boolean } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-who-is-who-" });
    yield* fs.writeFileString(
      path.join(dir, FRIDGE_FILE_NAME),
      JSON.stringify({ version: 1, pins: { "thread-leo-pinned": 1 } }),
    );
    const layerProjections = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: (threadId) =>
          Effect.succeed(
            THREADS.find((thread) => thread.id === threadId) === undefined
              ? null
              : shellOf(THREADS.find((thread) => thread.id === threadId)!),
          ),
        getThread: (threadId) => {
          const found = THREADS.find((thread) => thread.id === threadId);
          return found === undefined
            ? (Effect.fail({ _tag: "ProjectionStoreThreadNotFoundError" }) as never)
            : Effect.succeed(found as never);
        },
        getThreadWorktreePaths: () =>
          Effect.succeed(
            THREADS.flatMap((thread) =>
              thread.worktreePath === null
                ? []
                : [{ threadId: thread.id as ThreadId, worktreePath: thread.worktreePath }],
            ),
          ),
        getTurnItem: () => Effect.succeed(null),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () => Effect.succeed(PROJECTS as never),
        get: (projectId) =>
          Effect.succeed(
            Option.fromNullishOr(
              PROJECTS.find((project) => project.projectId === projectId) as never,
            ),
          ),
        findActiveByWorkspaceRoot: (root) =>
          Effect.succeed(
            Option.fromNullishOr(
              PROJECTS.find((project) => project.workspaceRoot === root) as never,
            ),
          ),
      }),
    );
    const layerFamily = SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME));
    const layer = SkycotFamilyGate.layerCore.pipe(
      Layer.provideMerge(SkycotFamilyVisibility.layerAt(path.join(dir, FRIDGE_FILE_NAME))),
      Layer.provideMerge(
        SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
      ),
      Layer.provideMerge(SkycotFamilyIdentity.layerSubjects(SUBJECTS)),
      Layer.provideMerge(Layer.merge(layerFamily, layerProjections)),
    );
    return yield* Effect.gen(function* () {
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      let avaId = "";
      let leoId = "";
      let mumId = "";
      if (options.on !== false) {
        const status = yield* family.enable({ code: CODE, childName: "Ava" });
        avaId = status.children[0]!.id;
        mumId = status.grownUps[0]!.id;
        leoId = (yield* family.addChild({ name: "Leo" })).childId;
        yield* family.addDevice({
          id: AVA_IPAD,
          kind: "child",
          personId: avaId,
          name: "Ava's iPad",
          linkId: "link-ava",
          linkExpiresAt: EPOCH + 60_000,
        });
        yield* family.addDevice({
          id: MUM_PHONE,
          kind: "grown-up",
          personId: mumId,
          name: "Mum's phone",
          linkId: "link-mum",
          linkExpiresAt: EPOCH + 60_000,
        });
        // Who started what, as the Mac's picker recorded it.
        yield* limits.choose({ sessionId: "mac-ava", childId: avaId, grownUp: false });
        yield* limits.choose({ sessionId: "mac-leo", childId: leoId, grownUp: false });
        yield* limits.recordStart({ sessionId: "mac-ava", threadId: "thread-ava" });
        yield* limits.recordStart({ sessionId: "mac-leo", threadId: "thread-leo" });
        yield* limits.recordStart({ sessionId: "mac-leo", threadId: "thread-leo-pinned" });
        yield* limits.recordStart({ sessionId: "mac-leo", projectId: "project-leo" });
      }
      return yield* use({
        gate: yield* SkycotFamilyGate.SkycotFamilyGate,
        family,
        limits,
        visibility: yield* SkycotFamilyVisibility.SkycotFamilyVisibility,
        identity: yield* SkycotFamilyIdentity.SkycotFamilyIdentity,
        avaId,
        leoId,
        mumId,
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped);

const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(Effect.map((exit) => Exit.isFailure(exit)));

const call = (sessionId: string, method: string, payload: unknown) => ({
  sessionId,
  method,
  payload,
});

it.layer(NodeServices.layer)("who is who", (it) => {
  it.effect("a child's iPad is always that child: no picker, no switching without a grown-up", () =>
    withWorld(({ limits, avaId, leoId, family }) =>
      Effect.gen(function* () {
        const session = yield* limits.forSession({ sessionId: "ava-ipad" });
        assert.equal(session.childId, avaId);
        assert.isFalse(session.needsChoice);
        assert.equal(session.device, "child");
        const refusal = yield* Effect.flip(
          limits.choose({ sessionId: "ava-ipad", childId: leoId, grownUp: false }),
        );
        assert.equal((refusal as SkycotFamilyLimits.FamilyLimitRefusal).reason, "device");
        assert.equal((yield* limits.forSession({ sessionId: "ava-ipad" })).childId, avaId);
        // A grown-up (the parent code) can give the iPad to Leo: the device record moves.
        yield* limits.choose({ sessionId: "ava-ipad", childId: leoId, grownUp: true });
        assert.equal((yield* limits.forSession({ sessionId: "ava-ipad" })).childId, leoId);
        const device = (yield* family.status).devices.find((entry) => entry.id === AVA_IPAD);
        assert.equal(device?.personId, leoId);
      }),
    ),
  );

  it.effect("a grown-up's phone is nobody's child: no picker and no limits", () =>
    withWorld(({ limits }) =>
      Effect.gen(function* () {
        const session = yield* limits.forSession({ sessionId: "mum-phone" });
        assert.isNull(session.childId);
        assert.isFalse(session.needsChoice);
        assert.equal(session.device, "grown-up");
        assert.isTrue(
          yield* refused(limits.choose({ sessionId: "mum-phone", childId: "x", grownUp: true })),
        );
      }),
    ),
  );

  it.effect(
    "a child's iPad cannot see, open, subscribe to or reply in a sibling's conversation",
    () =>
      withWorld(({ gate }) =>
        Effect.gen(function* () {
          const own = { threadId: "thread-ava" };
          const sibling = { threadId: "thread-leo" };
          for (const method of [
            ORCHESTRATION_V2_WS_METHODS.subscribeThread,
            ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
            ORCHESTRATION_V2_WS_METHODS.getTurnDiff,
            ORCHESTRATION_V2_WS_METHODS.searchThread,
          ]) {
            yield* gate.check(call("ava-ipad", method, own));
            assert.isTrue(yield* refused(gate.check(call("ava-ipad", method, sibling))), method);
            // The Mac keeps today's behaviour: siblings' work stays open there.
            yield* gate.check(call("mac-ava", method, sibling));
          }
          const reply = {
            type: "message.dispatch",
            commandId: "c1",
            messageId: "m1",
            text: "hi",
            ...sibling,
          };
          assert.isTrue(
            yield* refused(
              gate.check(call("ava-ipad", ORCHESTRATION_V2_WS_METHODS.dispatchCommand, reply)),
            ),
          );
          // An older conversation nobody is recorded as starting stays off the child's device.
          assert.isTrue(
            yield* refused(
              gate.check(
                call("ava-ipad", ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
                  threadId: "thread-old",
                }),
              ),
            ),
          );
          // A brand-new conversation is the child's own.
          yield* gate.check(
            call("ava-ipad", ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
              type: "thread.create",
              commandId: "c2",
              threadId: "thread-new",
              projectId: "project-family",
            }),
          );
          // Searching every conversation would list a sibling's.
          assert.isTrue(
            yield* refused(
              gate.check(
                call("ava-ipad", ORCHESTRATION_V2_WS_METHODS.searchThreads, { query: "game" }),
              ),
            ),
          );
        }),
      ),
  );

  it.effect(
    "a sibling's project and folders stay closed; a pinned page can be read, not changed",
    () =>
      withWorld(({ gate }) =>
        Effect.gen(function* () {
          assert.isTrue(
            yield* refused(
              gate.check(
                call("ava-ipad", ORCHESTRATION_V2_WS_METHODS.launchThread, {
                  projectId: "project-leo",
                  threadId: "thread-x",
                }),
              ),
            ),
          );
          // Leo's private copy, by its folder.
          assert.isTrue(
            yield* refused(
              gate.check(
                call("ava-ipad", "projects.readFile", {
                  cwd: "/w/leo-1",
                  relativePath: "index.html",
                }),
              ),
            ),
          );
          // A page Leo pinned to the fridge: readable on Ava's iPad, never writable.
          yield* gate.check(
            call("ava-ipad", "projects.readFile", { cwd: "/w/leo-2", relativePath: "index.html" }),
          );
          assert.isTrue(
            yield* refused(
              gate.check(
                call("ava-ipad", "projects.writeFile", {
                  cwd: "/w/leo-2",
                  relativePath: "index.html",
                  contents: "x",
                }),
              ),
            ),
          );
          // Her own private copy and the family's shared project stay open.
          yield* gate.check(
            call("ava-ipad", "projects.readFile", { cwd: "/w/ava-1", relativePath: "index.html" }),
          );
          yield* gate.check(call("ava-ipad", "projects.listEntries", { cwd: "/p/family" }));
        }),
      ),
  );

  it.effect("a child's iPad gets its own conversations and projects in the live list", () =>
    withWorld(({ visibility }) =>
      Effect.gen(function* () {
        const snapshot: OrchestrationV2ShellStreamItem = {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1,
            snapshotSequence: 1,
            threads: THREADS.map(shellOf),
            archivedThreads: [],
            projects: PROJECTS.map((project) => ({ id: project.projectId as ProjectId }) as never),
          },
        };
        const items: Array<OrchestrationV2ShellStreamItem> = [
          snapshot,
          { kind: "thread.updated", sequence: 2, location: "active", thread: shellOf(THREADS[1]!) },
          { kind: "thread.updated", sequence: 3, location: "active", thread: shellOf(THREADS[0]!) },
        ];
        const seen = yield* Stream.runCollect(
          visibility.filterShellStream("ava-ipad", Stream.fromIterable(items)),
        );
        const list = Array.from(seen);
        assert.equal(list.length, 2);
        const first = list[0]!;
        assert.equal(first.kind, "snapshot");
        if (first.kind === "snapshot") {
          assert.deepEqual(
            first.snapshot.threads.map((thread) => thread.id),
            ["thread-ava"],
          );
          assert.deepEqual(
            first.snapshot.projects.map((project) => project.id),
            ["project-family"],
          );
        }
        assert.equal(list[1]!.kind === "thread.updated" ? list[1]!.thread.id : "", "thread-ava");
        // The Mac and Mum's phone see everything.
        for (const sessionId of ["mac-ava", "mum-phone"]) {
          const all = yield* Stream.runCollect(
            visibility.filterShellStream(sessionId, Stream.fromIterable(items)),
          );
          assert.equal(Array.from(all).length, 3);
        }
      }),
    ),
  );

  it.effect("a grown-up's phone may read, and may not send, start, change or open files", () =>
    withWorld(({ gate }) =>
      Effect.gen(function* () {
        yield* gate.check(call("mum-phone", ORCHESTRATION_V2_WS_METHODS.subscribeShell, {}));
        yield* gate.check(
          call("mum-phone", ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
            threadId: "thread-leo",
          }),
        );
        const closed: Array<[string, unknown]> = [
          [
            ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            { type: "message.dispatch", threadId: "thread-ava", messageId: "m", text: "hi" },
          ],
          [
            ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            {
              type: "runtime-request.respond",
              threadId: "thread-ava",
              requestId: "r",
              decision: "acceptForSession",
            },
          ],
          [ORCHESTRATION_V2_WS_METHODS.launchThread, { projectId: "project-family" }],
          ["server.updateSettings", { patch: { defaultRuntimeMode: "approval-required" } }],
          ["projects.readFile", { cwd: "/w/ava-1", relativePath: "index.html" }],
          ["projects.writeFile", { cwd: "/w/ava-1", relativePath: "a", contents: "x" }],
          ["terminal.open", {}],
        ];
        for (const [method, payload] of closed) {
          assert.isTrue(yield* refused(gate.check(call("mum-phone", method, payload))), method);
        }
        assert.isTrue(
          SkycotFamilyGate.grownUpDeviceMayCall(ORCHESTRATION_V2_WS_METHODS.subscribeThread),
        );
        assert.isFalse(SkycotFamilyGate.grownUpDeviceMayCall("projects.readFile"));
        assert.isFalse(SkycotFamilyGate.grownUpDeviceMayCall("no.such.method"));
      }),
    ),
  );

  it.effect("a removed device is refused everything, at once", () =>
    withWorld(({ gate, family, identity }) =>
      Effect.gen(function* () {
        const shell = call("gone-phone", ORCHESTRATION_V2_WS_METHODS.subscribeShell, {});
        assert.isTrue(yield* refused(gate.check(shell)));
        yield* gate.check(call("mum-phone", ORCHESTRATION_V2_WS_METHODS.subscribeShell, {}));
        yield* family.removeDevice({ deviceId: MUM_PHONE });
        assert.equal((yield* identity.identify("mum-phone")).kind, "removed");
        assert.isTrue(
          yield* refused(
            gate.check(call("mum-phone", ORCHESTRATION_V2_WS_METHODS.subscribeShell, {})),
          ),
        );
        // The Mac is untouched.
        yield* gate.check(call("mac-ava", ORCHESTRATION_V2_WS_METHODS.subscribeShell, {}));
      }),
    ),
  );

  it.effect("a new parent code unlinks grown-ups' devices, and removing a child takes theirs", () =>
    withWorld(({ family, avaId, leoId }) =>
      Effect.gen(function* () {
        yield* family.changeCode({ oldCode: CODE, newCode: "731942" });
        assert.deepEqual(
          (yield* family.status).devices.map((device) => device.id),
          [AVA_IPAD],
        );
        yield* family.reassignDevice({ deviceId: AVA_IPAD, childId: leoId });
        yield* family.removeChild({ childId: leoId });
        assert.deepEqual((yield* family.status).devices, []);
        assert.isTrue(
          yield* refused(
            family.addDevice({
              id: "d4444444444",
              kind: "child",
              personId: "nobody",
              name: null,
              linkId: "l",
              linkExpiresAt: 0,
            }),
          ),
        );
        assert.isString(avaId);
      }),
    ),
  );

  it.effect("with the Family profile off, every session is the Mac's, as T3 has it", () =>
    withWorld(
      ({ gate, identity, limits }) =>
        Effect.gen(function* () {
          assert.equal((yield* identity.identify("mac-ava")).kind, "shared");
          // A device subject with no profile has nothing to belong to.
          assert.equal((yield* identity.identify("ava-ipad")).kind, "removed");
          yield* gate.check(
            call("mac-ava", ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
              threadId: "thread-leo",
            }),
          );
          yield* gate.check(call("mac-ava", "terminal.open", {}));
          assert.equal((yield* limits.forSession({ sessionId: "mac-ava" })).device, "shared");
        }),
      { on: false },
    ),
  );
});

describe("who is who: pure parts", () => {
  it("finds every id a call names, nested ones too", () => {
    assert.deepEqual(
      referencedBy({
        type: "message.dispatch",
        threadId: "t1",
        sourcePlanRef: { threadId: "t2", planId: "p" },
        resource: { _tag: "draft-workspace-file", cwd: "/w/x", path: "a" },
      }),
      { threadIds: ["t1", "t2"], projectIds: [], folders: ["/w/x"] },
    );
    assert.deepEqual(
      referencedBy({ type: "thread.fork", sourceThreadId: "a", targetThreadId: "b" }).threadIds,
      ["b", "a"],
    );
  });

  it("a private copy beats its project folder; the project wins a tie", () => {
    const known = {
      threads: [
        { threadId: "t1", worktreePath: "/p/family/.worktrees/t1" },
        { threadId: "t2", worktreePath: "/p/family" },
      ],
      projects: [{ projectId: "family", workspaceRoot: "/p/family" }],
    };
    assert.deepEqual(folderOwner("/p/family/.worktrees/t1/src", known), {
      type: "thread",
      id: "t1",
    });
    assert.deepEqual(folderOwner("/p/family/src", known), { type: "project", id: "family" });
    assert.isNull(folderOwner("/elsewhere", known));
    assert.isNull(folderOwner("/p/familyish", known));
  });

  it("filters a snapshot to the child's own conversations, keeping projects they work in", () => {
    const filtered = filterShellSnapshot(
      {
        childId: "ava",
        owners: { threads: { a: "ava", b: "leo" }, projects: { pl: "leo" } },
        pinned: new Set(),
      },
      {
        schemaVersion: 1,
        snapshotSequence: 1,
        threads: [
          { id: "a", projectId: "pl" },
          { id: "b", projectId: "pl" },
        ] as never,
        archivedThreads: [],
        projects: [{ id: "pl" }, { id: "pf" }] as never,
      },
    );
    assert.deepEqual(
      filtered.threads.map((thread) => thread.id),
      ["a"],
    );
    assert.deepEqual(
      filtered.projects.map((project) => project.id),
      ["pl", "pf"],
    );
  });
});

/* The device service: links, removal, the approver's answers. */

interface Recorded {
  readonly links: Array<{
    readonly scopes: ReadonlyArray<string>;
    readonly subject: string;
    readonly ttl: unknown;
  }>;
  readonly revokedSessions: Array<string>;
  readonly revokedLinks: Array<string>;
  readonly dispatched: Array<Record<string, unknown>>;
}

const withDevices = <A, E>(
  use: (
    input: World & {
      readonly devices: SkycotFamilyDevices.SkycotFamilyDevices["Service"];
      readonly recorded: Recorded;
      readonly request: { status: "pending" | "resolved"; createdAt: DateTime.Utc };
    },
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const recorded: Recorded = { links: [], revokedSessions: [], revokedLinks: [], dispatched: [] };
    const request = {
      status: "pending" as "pending" | "resolved",
      createdAt: DateTime.makeUnsafe(EPOCH),
    };
    return yield* withWorld((world) =>
      Effect.gen(function* () {
        const layer = SkycotFamilyDevices.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(SkycotFamily.SkycotFamily, world.family),
              Layer.succeed(SkycotFamilyGate.SkycotFamilyGate, {
                ...world.gate,
                describeRequest: () =>
                  Effect.succeed({
                    needsGrownUp: true,
                    why: "It uses the internet.",
                    what: "npm install three",
                    kind: "command" as const,
                  }),
              }),
              Layer.succeed(SkycotFamilyLimits.SkycotFamilyLimits, world.limits),
              Layer.mock(EnvironmentAuth.EnvironmentAuth)({
                createPairingLink: (input) => {
                  recorded.links.push({
                    scopes: input?.scopes ?? [],
                    subject: input?.subject ?? "",
                    ttl: input?.ttl,
                  });
                  return Effect.succeed({
                    id: `link-${recorded.links.length}`,
                    credential: "7KQ3M9XD2HPA",
                    scopes: input?.scopes ?? [],
                    subject: input?.subject ?? "",
                    createdAt: DateTime.makeUnsafe(EPOCH),
                    expiresAt: DateTime.makeUnsafe(EPOCH + 300_000),
                  });
                },
                revokePairingLink: (id) => {
                  recorded.revokedLinks.push(id);
                  return Effect.succeed(true);
                },
                listSessions: () =>
                  Effect.succeed(
                    Object.entries(SUBJECTS).map(([sessionId, subject]) => ({
                      sessionId: sessionId as AuthSessionId,
                      subject,
                      scopes: [],
                      permissions: [],
                      method: "browser-session-cookie",
                      client: { deviceType: "unknown" },
                      issuedAt: DateTime.makeUnsafe(EPOCH - 1000),
                      expiresAt: DateTime.makeUnsafe(EPOCH + 1000_000),
                      lastConnectedAt: null,
                      connected: false,
                      current: false,
                    })) as never,
                  ),
                revokeSession: (sessionId) => {
                  recorded.revokedSessions.push(sessionId);
                  return Effect.succeed(true);
                },
              }),
              Layer.mock(Orchestrator.OrchestratorV2)({
                dispatch: (command) => {
                  if (request.status !== "pending")
                    return Effect.fail({ _tag: "Rejected" } as never);
                  recorded.dispatched.push(command as never);
                  request.status = "resolved";
                  return Effect.succeed({ sequence: 1 } as never);
                },
              }),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({
                getRuntimeRequest: () =>
                  Effect.succeed({
                    id: "req-1",
                    status: request.status,
                    responseCapability: { type: "live", providerSessionId: "p" },
                    createdAt: request.createdAt,
                  } as never),
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 1,
                    snapshotSequence: 1,
                    threads: [
                      {
                        ...(shellOf(THREADS[0]!) as object),
                        pendingRuntimeRequest: {
                          id: "req-1",
                          kind: "command",
                          createdAt: request.createdAt,
                        },
                      },
                    ],
                    archivedThreads: [],
                  } as never),
              }),
              Layer.mock(ProjectStore.ProjectStoreV2)({
                list: () => Effect.succeed(PROJECTS as never),
              }),
            ),
          ),
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "skycot-devices-" })),
        );
        const devices = yield* Effect.provide(SkycotFamilyDevices.SkycotFamilyDevices, layer);
        return yield* use({ ...world, devices, recorded, request });
      }),
    );
  });

const mum = (world: World) =>
  ({
    kind: "grown-up",
    deviceId: MUM_PHONE,
    personId: world.mumId,
    deviceName: "Mum's phone",
  }) as const;

it.layer(NodeServices.layer)("linked devices", (it) => {
  it.effect(
    "a link is T3's one-time pairing link, with the person's subject and narrow scopes",
    () =>
      withDevices(({ devices, recorded, avaId, mumId, family }) =>
        Effect.gen(function* () {
          const child = yield* devices.createLink({
            kind: "child",
            personId: avaId,
            name: "Ava's iPad",
          });
          const grownUp = yield* devices.createLink({
            kind: "grown-up",
            personId: mumId,
            name: null,
          });
          assert.equal(recorded.links[0]!.subject, deviceSubject(child.deviceId));
          assert.include(recorded.links[0]!.scopes, AuthOrchestrationOperateScope);
          assert.notInclude(recorded.links[0]!.scopes, AuthTerminalOperateScope);
          assert.notInclude(recorded.links[0]!.scopes, "access:write");
          assert.deepEqual(recorded.links[1]!.scopes, [AuthOrchestrationReadScope]);
          assert.equal(recorded.links[1]!.subject, deviceSubject(grownUp.deviceId));
          const status = yield* family.status;
          assert.equal(
            status.devices.find((device) => device.id === child.deviceId)?.kind,
            "child",
          );
          // Someone who isn't in the family gets no link, and no link is left behind.
          assert.isTrue(
            yield* refused(devices.createLink({ kind: "child", personId: mumId, name: null })),
          );
          assert.include(recorded.revokedLinks, "link-3");
        }),
      ),
  );

  it.effect("Remove ends the device's sign-in and record at once", () =>
    withDevices(({ devices, recorded, identity, family }) =>
      Effect.gen(function* () {
        yield* devices.remove(AVA_IPAD);
        assert.deepEqual(recorded.revokedSessions, ["ava-ipad"]);
        assert.include(recorded.revokedLinks, "link-ava");
        assert.equal((yield* identity.identify("ava-ipad")).kind, "removed");
        assert.isUndefined((yield* family.status).devices.find((device) => device.id === AVA_IPAD));
      }),
    ),
  );

  it.effect(
    "Mum's phone sees the waiting request, says yes once with the code, and it is logged",
    () =>
      withDevices((world) =>
        Effect.gen(function* () {
          const { devices, recorded, limits, avaId } = world;
          const [pending] = yield* devices.approvals;
          assert.equal(pending?.childId, avaId);
          assert.equal(pending?.what, "npm install three");
          assert.isFalse(pending?.lapsed);
          const answer = (overrides: Partial<Parameters<typeof devices.answer>[0]> = {}) =>
            devices.answer({
              who: mum(world),
              sessionId: "mum-phone",
              origin: "http://localhost:3790",
              threadId: "thread-ava",
              requestId: "req-1",
              decision: "accept",
              fingerprint: pending!.fingerprint,
              proof: { type: "code", code: CODE },
              ...overrides,
            });
          // A yes needs proof; a card that changed can't be approved unseen; a wrong code counts.
          assert.isTrue(yield* refused(answer({ proof: null })));
          assert.isTrue(yield* refused(answer({ fingerprint: "something-else" })));
          assert.isTrue(yield* refused(answer({ proof: { type: "code", code: "000000" } })));
          assert.equal((yield* world.family.status).attemptsLeft, SkycotFamily.MAX_ATTEMPTS - 1);
          assert.equal(recorded.dispatched.length, 0);
          yield* answer();
          assert.equal(recorded.dispatched.length, 1);
          assert.equal(recorded.dispatched[0]!["decision"], "accept");
          assert.equal(recorded.dispatched[0]!["requestId"], "req-1");
          // Once: the same yes again finds nothing waiting.
          assert.isTrue(yield* refused(answer()));
          assert.equal(recorded.dispatched.length, 1);
          const events = (yield* limits.snapshot)!.activity.events;
          const logged = events.find((event) => event.requestId === "req-1");
          assert.equal(logged?.kind, "approved");
          assert.equal(logged?.childId, avaId);
          assert.equal(logged?.by?.deviceName, "Mum's phone");
        }),
      ),
  );

  it.effect("saying no needs no proof; a request older than ten minutes waits on the Mac", () =>
    withDevices((world) =>
      Effect.gen(function* () {
        const { devices, recorded, request } = world;
        // The engine's clock (a test clock here) is what a request's age is read on.
        yield* TestClock.setTime(EPOCH);
        const [pending] = yield* devices.approvals;
        request.createdAt = DateTime.makeUnsafe(EPOCH - 11 * 60_000);
        assert.isTrue(
          yield* refused(
            devices.answer({
              who: mum(world),
              sessionId: "mum-phone",
              origin: "http://localhost:3790",
              threadId: "thread-ava",
              requestId: "req-1",
              decision: "decline",
              fingerprint: pending!.fingerprint,
              proof: null,
            }),
          ),
        );
        request.createdAt = DateTime.makeUnsafe(EPOCH);
        yield* devices.answer({
          who: mum(world),
          sessionId: "mum-phone",
          origin: "http://localhost:3790",
          threadId: "thread-ava",
          requestId: "req-1",
          decision: "decline",
          fingerprint: pending!.fingerprint,
          proof: null,
        });
        assert.equal(recorded.dispatched[0]!["decision"], "decline");
      }),
    ),
  );

  it.effect("Face ID needs a secure address; over plain home Wi-Fi the code is the way", () =>
    withDevices((world) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          world.devices.passkeyOptions({
            who: mum(world),
            origin: "http://192.168.1.20:3790",
            code: CODE,
          }),
        );
        assert.equal((error as SkycotFamilyDevices.DevicesError).reason, "insecure");
        const options = (yield* world.devices.passkeyOptions({
          who: mum(world),
          origin: "http://localhost:3790",
          code: CODE,
        })) as { readonly rp: { readonly id: string } };
        assert.equal(options.rp.id, "localhost");
      }),
    ),
  );
});
