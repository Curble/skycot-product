// Test fixtures use loose stand-ins on purpose.
// @effect-diagnostics anyUnknownInErrorContext:off
// @effect-diagnostics unsafeEffectTypeAssertion:off
// Just ask, one space per child, judged by the real Family gate, limits, who-is-who and
// visibility over stand-in projects and conversations. Ava and Leo each have their own iPad,
// Mum has her phone, and the family's Mac has the "Who's using SKYCOT?" picker.
//
// The bug this guards against (found in Phase 2 testing): Just ask used one shared Questions
// project, and the first child to ask was recorded as its owner, so the other child's own iPad
// was refused Just ask ("Crew couldn't start just now"), at home and through the relay.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  RpcScopeAuthorization,
  type OrchestrationV2ShellStreamItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { deviceSubject } from "@t3tools/skycot-rules/people";
import { questionsSpaceOf } from "@t3tools/skycot-rules/questions";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { FRIDGE_FILE_NAME } from "../family-fridge/SkycotFridge.ts";
import * as SkycotFamilyIdentity from "../family-devices/SkycotFamilyIdentity.ts";
import * as SkycotFamilyVisibility from "../family-devices/SkycotFamilyVisibility.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import * as SkycotQuestions from "./SkycotQuestions.ts";
import * as SkycotQuestionSpaces from "./SkycotQuestionSpaces.ts";

const CODE = "482913";
const EPOCH = Date.UTC(2026, 9, 24, 9, 0, 0);
const AVA_IPAD = "d1111111111";
const LEO_IPAD = "d4444444444";
const MUM_PHONE = "d2222222222";
/** T3's Scratch project: the one shared space Just ask used before. */
const SHARED = "project:questions";

const SUBJECTS: Record<string, string> = {
  mac: "desktop",
  "ava-ipad": deviceSubject(AVA_IPAD),
  "leo-ipad": deviceSubject(LEO_IPAD),
  "mum-phone": deviceSubject(MUM_PHONE),
};

interface FakeProject {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly title: string;
}
interface FakeThread {
  readonly id: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
}

const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(Effect.map((exit) => Exit.isFailure(exit)));

interface World {
  readonly root: string;
  readonly gate: SkycotFamilyGate.SkycotFamilyGate["Service"];
  readonly family: SkycotFamily.SkycotFamily["Service"];
  readonly limits: SkycotFamilyLimits.SkycotFamilyLimits["Service"];
  readonly visibility: SkycotFamilyVisibility.SkycotFamilyVisibility["Service"];
  readonly projects: Map<string, FakeProject>;
  readonly threads: Array<FakeThread>;
  readonly avaId: string;
  readonly leoId: string;
  /** "Open Questions" as the socket answers it for this session (T3's answer: the shared space). */
  readonly openQuestions: (sessionId: string) => Effect.Effect<string, unknown>;
  /** Just ask on this session: open Questions, then start the question; the engine makes its folder. */
  readonly justAsk: (
    sessionId: string,
    threadId: string,
    text?: string,
  ) => Effect.Effect<FakeThread, unknown>;
  readonly check: (
    sessionId: string,
    method: string,
    payload: unknown,
  ) => Effect.Effect<void, unknown>;
  /** What this session's live list shows: project ids and conversation ids. */
  readonly sees: (
    sessionId: string,
  ) => Effect.Effect<{ readonly projects: Array<string>; readonly threads: Array<string> }>;
}

/** Ava and Leo with their own iPads, Mum's phone, and the Mac; T3's Scratch project already made. */
const withWorld = <A, E, R>(
  use: (world: World) => Effect.Effect<A, E, R>,
  options: { readonly on?: boolean; readonly before?: ReadonlyArray<FakeThread> } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-just-ask-per-child-" });
    const root = path.join(dir, "scratch");
    yield* fs.makeDirectory(root, { recursive: true });
    const projects = new Map<string, FakeProject>([
      [SHARED, { projectId: SHARED, workspaceRoot: root, title: "No project" }],
    ]);
    const threads: Array<FakeThread> = [...(options.before ?? [])].map((thread) => ({
      ...thread,
      worktreePath: thread.worktreePath === null ? null : path.join(root, thread.worktreePath),
    }));
    const byRoot = (workspaceRoot: string) =>
      [...projects.values()].find((project) => project.workspaceRoot === workspaceRoot);
    const asProject = (project: FakeProject) =>
      ({ ...project, id: project.projectId as ProjectId }) as never;

    const layerStores = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: (threadId) =>
          Effect.succeed((threads.find((thread) => thread.id === threadId) ?? null) as never),
        getThread: (threadId) => {
          const found = threads.find((thread) => thread.id === threadId);
          return found === undefined
            ? (Effect.fail({ _tag: "ProjectionStoreThreadNotFoundError" }) as never)
            : Effect.succeed(found as never);
        },
        getThreadWorktreePaths: () =>
          Effect.succeed(
            threads.flatMap((thread) =>
              thread.worktreePath === null
                ? []
                : [{ threadId: thread.id as ThreadId, worktreePath: thread.worktreePath }],
            ),
          ),
        getTurnItem: () => Effect.succeed(null),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () => Effect.sync(() => [...projects.values()] as never),
        get: (projectId) =>
          Effect.sync(() => Option.fromNullishOr(projects.get(projectId) as never)),
        findActiveByWorkspaceRoot: (workspaceRoot) =>
          Effect.sync(() => Option.fromNullishOr(byRoot(workspaceRoot) as never)),
      }),
      // The engine's project service and Scratch root, as far as the children's spaces use them.
      Layer.mock(ProjectService.ProjectService)({
        bootstrap: (input) =>
          Effect.sync(() => {
            const existing = byRoot(input.workspaceRoot);
            if (existing !== undefined) return { project: asProject(existing), created: false };
            const project = {
              projectId: input.projectId,
              workspaceRoot: input.workspaceRoot,
              title: input.title,
            };
            projects.set(project.projectId, project);
            return { project: asProject(project), created: true };
          }),
        update: (input) =>
          Effect.sync(() => {
            const project = projects.get(input.projectId)!;
            const next = { ...project, ...(input.title ? { title: input.title } : {}) };
            projects.set(project.projectId, next);
            return asProject(next);
          }),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        scratchRoot: Effect.succeed(Option.some(root)),
        namedProjectsRoot: path.join(dir, "projects"),
      }),
    );
    const layer = SkycotFamilyGate.layerCore.pipe(
      Layer.provideMerge(SkycotQuestionSpaces.layer),
      Layer.provideMerge(SkycotFamilyVisibility.layerAt(path.join(dir, FRIDGE_FILE_NAME))),
      Layer.provideMerge(
        SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
      ),
      Layer.provideMerge(SkycotFamilyIdentity.layerSubjects(SUBJECTS)),
      Layer.provideMerge(
        Layer.mergeAll(
          SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME)),
          layerStores,
          SkycotQuestions.layerTest(root),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
      const family = yield* SkycotFamily.SkycotFamily;
      const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
      const visibility = yield* SkycotFamilyVisibility.SkycotFamilyVisibility;
      let avaId = "";
      let leoId = "";
      if (options.on !== false) {
        const status = yield* family.enable({ code: CODE, childName: "Ava" });
        avaId = status.children[0]!.id;
        leoId = (yield* family.addChild({ name: "Leo" })).childId;
        const device = (id: string, kind: "child" | "grown-up", personId: string, name: string) =>
          family.addDevice({
            id,
            kind,
            personId,
            name,
            linkId: `link-${id}`,
            linkExpiresAt: EPOCH + 60_000,
          });
        yield* device(AVA_IPAD, "child", avaId, "Ava's iPad");
        yield* device(LEO_IPAD, "child", leoId, "Leo's iPad");
        yield* device(MUM_PHONE, "grown-up", status.grownUps[0]!.id, "Mum's phone");
      }
      const layerScope = Layer.succeed(RpcScopeAuthorization)((effect) => effect);
      const openQuestions = (sessionId: string) =>
        Effect.gen(function* () {
          // The socket's middleware: the gate's check, then its answer, then the scope check.
          const middleware = yield* RpcScopeAuthorization;
          const answer = yield* middleware(
            Effect.succeed({ projectId: ProjectId.make(SHARED) }) as never,
            { rpc: { _tag: "projects.ensureScratch" }, payload: {} } as never,
          );
          return String((answer as unknown as { readonly projectId: string }).projectId);
        }).pipe(
          Effect.provide(
            SkycotFamilyGate.layerRpcAuthorization(gate, sessionId).pipe(Layer.provide(layerScope)),
          ),
          Effect.scoped,
        );
      const check = (sessionId: string, method: string, payload: unknown) =>
        gate.check({ sessionId, method, payload });
      const justAsk = (sessionId: string, threadId: string, text = "Why is the sky blue?") =>
        Effect.gen(function* () {
          const projectId = yield* openQuestions(sessionId);
          yield* check(sessionId, ORCHESTRATION_V2_WS_METHODS.launchThread, {
            commandId: CommandId.make(`command:${threadId}`),
            threadId,
            projectId,
            title: text,
            workspaceStrategy: { type: "root" },
            initialMessage: { messageId: `message:${threadId}`, text, attachments: [] },
          });
          // The engine then makes the question's own folder inside its space.
          const thread = {
            id: threadId,
            projectId,
            worktreePath: path.join(
              projects.get(projectId)!.workspaceRoot,
              `2026-10-24-${threadId}`,
            ),
          };
          threads.push(thread);
          return thread;
        });
      const sees = (sessionId: string) =>
        Effect.gen(function* () {
          const item: OrchestrationV2ShellStreamItem = {
            kind: "snapshot",
            snapshot: {
              schemaVersion: 1,
              snapshotSequence: 1,
              threads: threads.map(
                (thread) => ({ ...thread, title: thread.id, pendingRuntimeRequest: null }) as never,
              ),
              archivedThreads: [],
              projects: [...projects.values()].map(
                (project) =>
                  ({ id: project.projectId, workspaceRoot: project.workspaceRoot }) as never,
              ),
            },
          };
          const seen = Array.from(
            yield* Stream.runCollect(visibility.filterShellStream(sessionId, Stream.make(item))),
          )[0]!;
          if (seen.kind !== "snapshot") throw new Error("expected the snapshot");
          return {
            projects: seen.snapshot.projects.map((project) => String(project.id)).sort(),
            threads: seen.snapshot.threads.map((thread) => String(thread.id)).sort(),
          };
        });
      return yield* use({
        root,
        gate,
        family,
        limits,
        visibility,
        projects,
        threads,
        avaId,
        leoId,
        openQuestions,
        justAsk,
        check,
        sees,
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped);

const spaceOwner = (world: World, projectId: string) => {
  const space = questionsSpaceOf(world.projects.get(projectId)?.workspaceRoot, world.root);
  return space?.kind === "child" ? space.childId : space?.kind;
};

it.layer(NodeServices.layer)("Just ask, one space per child", (it) => {
  it.effect("two children each Just ask on their own locked devices (the Phase 2 bug)", () =>
    withWorld((world) =>
      Effect.gen(function* () {
        const ava = yield* world.justAsk("ava-ipad", "thread-ava-sky");
        // Before: Leo's iPad was refused here, because the shared space had become Ava's.
        const leo = yield* world.justAsk("leo-ipad", "thread-leo-dino", "Draw a dinosaur");
        assert.notEqual(ava.projectId, leo.projectId);
        assert.notEqual(ava.projectId, SHARED);
        assert.equal(spaceOwner(world, ava.projectId), world.avaId);
        assert.equal(spaceOwner(world, leo.projectId), world.leoId);
        // A second question goes to the same space, and each keeps asking freely.
        const again = yield* world.justAsk("leo-ipad", "thread-leo-moon", "How far is the moon?");
        assert.equal(again.projectId, leo.projectId);
        yield* world.justAsk("ava-ipad", "thread-ava-cats", "Why do cats purr?");
        // Each question is recorded as its asker's.
        const today = yield* world.limits.today;
        assert.equal(today.threads["thread-ava-sky"], world.avaId);
        assert.equal(today.threads["thread-leo-dino"], world.leoId);
      }),
    ),
  );

  it.effect(
    "neither child sees the other's questions, and a sibling's are refused like a project",
    () =>
      withWorld((world) =>
        Effect.gen(function* () {
          const ava = yield* world.justAsk("ava-ipad", "thread-ava-sky");
          const leo = yield* world.justAsk("leo-ipad", "thread-leo-dino", "Draw a dinosaur");

          assert.deepEqual(yield* world.sees("ava-ipad"), {
            projects: [ava.projectId],
            threads: ["thread-ava-sky"],
          });
          assert.deepEqual(yield* world.sees("leo-ipad"), {
            projects: [leo.projectId],
            threads: ["thread-leo-dino"],
          });

          // Ava's iPad naming Leo's space, his question, or its folder: refused, every way.
          const fromAva = (method: string, payload: unknown) =>
            refused(world.check("ava-ipad", method, payload));
          assert.isTrue(
            yield* fromAva(ORCHESTRATION_V2_WS_METHODS.launchThread, {
              projectId: leo.projectId,
              threadId: "thread-ava-sneaky",
              workspaceStrategy: { type: "root" },
            }),
          );
          assert.isTrue(
            yield* fromAva(ORCHESTRATION_V2_WS_METHODS.subscribeThread, { threadId: leo.id }),
          );
          assert.isTrue(
            yield* fromAva(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
              type: "message.dispatch",
              threadId: leo.id,
              messageId: "m-x",
              text: "hi",
            }),
          );
          assert.isTrue(
            yield* fromAva("projects.readFile", {
              cwd: leo.worktreePath,
              relativePath: "dino.html",
            }),
          );
          assert.isTrue(
            yield* fromAva("projects.listEntries", {
              cwd: world.projects.get(leo.projectId)!.workspaceRoot,
            }),
          );
          // Her own stays open.
          yield* world.check("ava-ipad", ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
            threadId: ava.id,
          });
          yield* world.check("ava-ipad", "projects.readFile", {
            cwd: ava.worktreePath,
            relativePath: "sky.html",
          });
        }),
      ),
  );

  it.effect("the shared Mac's picker decides whose space a question goes to", () =>
    withWorld((world) =>
      Effect.gen(function* () {
        yield* world.limits.choose({ sessionId: "mac", childId: world.avaId, grownUp: false });
        const ava = yield* world.justAsk("mac", "thread-mac-ava");
        yield* world.limits.choose({ sessionId: "mac", childId: world.leoId, grownUp: false });
        const leo = yield* world.justAsk("mac", "thread-mac-leo", "Draw a dinosaur");
        assert.equal(spaceOwner(world, ava.projectId), world.avaId);
        assert.equal(spaceOwner(world, leo.projectId), world.leoId);
        // The same spaces their own iPads use.
        assert.equal(yield* world.openQuestions("ava-ipad"), ava.projectId);
        assert.equal(yield* world.openQuestions("leo-ipad"), leo.projectId);
        // A question asked on the Mac for Ava shows on Ava's iPad, not on Leo's.
        assert.deepEqual((yield* world.sees("ava-ipad")).threads, ["thread-mac-ava"]);
        assert.deepEqual((yield* world.sees("leo-ipad")).threads, ["thread-mac-leo"]);
      }),
    ),
  );

  it.effect("grown-ups see every child's questions; their phone opens none", () =>
    withWorld((world) =>
      Effect.gen(function* () {
        const ava = yield* world.justAsk("ava-ipad", "thread-ava-sky");
        const leo = yield* world.justAsk("leo-ipad", "thread-leo-dino", "Draw a dinosaur");
        const everything = {
          projects: [SHARED, ava.projectId, leo.projectId].sort(),
          threads: ["thread-ava-sky", "thread-leo-dino"],
        };
        assert.deepEqual(yield* world.sees("mum-phone"), everything);
        assert.deepEqual(yield* world.sees("mac"), everything);
        // A grown-up's phone reads; it never starts a question or makes a space.
        assert.isTrue(yield* refused(world.openQuestions("mum-phone")));
        yield* world.check("mum-phone", ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
          threadId: leo.id,
        });
      }),
    ),
  );

  it.effect(
    "Make this a project: the new project is the child's, and a sibling can't take it",
    () =>
      withWorld((world) =>
        Effect.gen(function* () {
          const ava = yield* world.justAsk("ava-ipad", "thread-ava-volcano", "Make a volcano page");
          yield* world.justAsk("leo-ipad", "thread-leo-dino", "Draw a dinosaur");
          const create = (projectId: string, workspaceRoot: string) => ({
            type: "project.create",
            commandId: `command:${projectId}`,
            projectId,
            title: "Volcano",
            workspaceRoot,
          });
          // Leo's iPad can't make Ava's question into a project of his.
          assert.isTrue(
            yield* refused(
              world.check(
                "leo-ipad",
                "projects.mutate",
                create("project-leo-grab", ava.worktreePath!),
              ),
            ),
          );
          // Ava's can, without the parent code, and the engine records the project as hers.
          yield* world.check(
            "ava-ipad",
            "projects.mutate",
            create("project-volcano", ava.worktreePath!),
          );
          world.projects.set("project-volcano", {
            projectId: "project-volcano",
            workspaceRoot: ava.worktreePath!,
            title: "Volcano",
          });
          assert.equal((yield* world.limits.today).projects["project-volcano"], world.avaId);
          assert.include((yield* world.sees("ava-ipad")).projects, "project-volcano");
          assert.notInclude((yield* world.sees("leo-ipad")).projects, "project-volcano");
          // New conversations in it are hers to start; Leo's iPad is refused.
          yield* world.check("ava-ipad", ORCHESTRATION_V2_WS_METHODS.launchThread, {
            projectId: "project-volcano",
            threadId: "thread-ava-volcano-2",
          });
          assert.isTrue(
            yield* refused(
              world.check("leo-ipad", ORCHESTRATION_V2_WS_METHODS.launchThread, {
                projectId: "project-volcano",
                threadId: "thread-leo-volcano",
              }),
            ),
          );
          // Undo of "Make this a project" stays open; a whole Questions space is not removable so.
          yield* world.check("ava-ipad", "projects.mutate", {
            type: "project.delete",
            commandId: "command:undo",
            projectId: "project-volcano",
          });
          assert.isTrue(
            yield* refused(
              world.check("ava-ipad", "projects.mutate", {
                type: "project.delete",
                commandId: "command:drop-space",
                projectId: ava.projectId,
              }),
            ),
          );
        }),
      ),
  );

  it.effect("earlier questions in the shared space keep working, each still its asker's", () =>
    withWorld(
      (world) =>
        Effect.gen(function* () {
          // The Mac as the bug left it: Ava asked first, so the shared space was recorded as hers.
          yield* world.limits.recordStart({
            sessionId: "ava-ipad",
            threadId: "thread-old-ava",
            projectId: SHARED,
          });
          assert.equal((yield* world.limits.today).projects[SHARED], world.avaId);

          // Leo can Just ask now, in his own space, despite that record.
          const leo = yield* world.justAsk("leo-ipad", "thread-leo-dino", "Draw a dinosaur");
          assert.equal(spaceOwner(world, leo.projectId), world.leoId);

          // Ava keeps her earlier question (listed, and she can keep talking in it)...
          const avaSees = yield* world.sees("ava-ipad");
          assert.include(avaSees.projects, SHARED);
          assert.deepEqual(avaSees.threads, ["thread-old-ava"]);
          yield* world.check("ava-ipad", ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
            type: "message.dispatch",
            threadId: "thread-old-ava",
            messageId: "m-1",
            text: "And at sunset?",
          });
          yield* world.check("ava-ipad", "projects.readFile", {
            cwd: world.threads.find((thread) => thread.id === "thread-old-ava")!.worktreePath,
            relativePath: "sky.html",
          });
          // ...but her new questions go to her own space, never the shared one.
          const ava = yield* world.justAsk("ava-ipad", "thread-ava-new");
          assert.equal(spaceOwner(world, ava.projectId), world.avaId);
          assert.isTrue(
            yield* refused(
              world.check("ava-ipad", ORCHESTRATION_V2_WS_METHODS.launchThread, {
                projectId: SHARED,
                threadId: "thread-ava-shared",
                workspaceStrategy: { type: "root" },
              }),
            ),
          );

          // Leo never sees the shared space; nobody's earlier questions are on a child's device.
          const leoSees = yield* world.sees("leo-ipad");
          assert.notInclude(leoSees.projects, SHARED);
          assert.deepEqual(leoSees.threads, ["thread-leo-dino"]);
          for (const sessionId of ["ava-ipad", "leo-ipad"]) {
            assert.isTrue(
              yield* refused(
                world.check(sessionId, ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
                  threadId: "thread-old-unknown",
                }),
              ),
            );
          }
          // Grown-ups see every earlier question, the unknown one included.
          assert.includeMembers((yield* world.sees("mum-phone")).threads, [
            "thread-old-ava",
            "thread-old-unknown",
          ]);
          // No file was moved: the earlier questions' folders are still where they were.
          for (const thread of world.threads.filter((entry) => entry.id.startsWith("thread-old"))) {
            assert.equal(
              questionsSpaceOf(world.projects.get(thread.projectId)!.workspaceRoot, world.root)
                ?.kind,
              "shared",
            );
          }
        }),
      {
        before: [
          {
            id: "thread-old-ava",
            projectId: SHARED,
            worktreePath: "2026-10-23-why-is-the-sky-blue",
          },
          {
            id: "thread-old-unknown",
            projectId: SHARED,
            worktreePath: "2026-10-23-a-grown-ups-question",
          },
        ],
      },
    ),
  );

  it.effect("with the profile off, Just ask is T3's one shared space, as before", () =>
    withWorld(
      (world) =>
        Effect.gen(function* () {
          assert.equal(yield* world.openQuestions("mac"), SHARED);
          assert.equal(world.projects.size, 1);
        }),
      { on: false },
    ),
  );

  it.effect("on the Mac with several children and nobody picked, the shared space answers", () =>
    withWorld((world) =>
      Effect.gen(function* () {
        assert.equal(yield* world.openQuestions("mac"), SHARED);
        assert.equal(world.projects.size, 1);
      }),
    ),
  );
});
