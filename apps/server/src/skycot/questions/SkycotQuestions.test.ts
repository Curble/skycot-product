// "Just ask" in the engine: a question works in its own folder inside SKYCOT's Questions space,
// the Family gate treats that folder as the child's own project, "Make this a project" is open
// there and nowhere else, and the recap counts a question's messages but lists it as made only
// once it changed a file.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import type * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import type { ActivitySnapshot } from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import { buildRecap, type RecapThreadInput } from "../family-recap/recap.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import * as SkycotFamilyGate from "../SkycotFamilyGate.ts";
import { SKYCOT_POLICY_ENV } from "../SkycotPolicy.ts";
import * as SkycotQuestions from "./SkycotQuestions.ts";

const CODE = "482913";
const SESSION = "session-1";
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const NOW = DateTime.makeUnsafe("2026-10-23T09:00:00.000Z");
const SPACE = "/Users/kid/.skycot/scratch";
const MINE = `${SPACE}/2026-10-23-why-do-volcanoes-erupt-1a2b3c4d`;
const SISTERS = `${SPACE}/2026-10-23-make-a-pony-page-5e6f7a8b`;
const QUESTIONS = ProjectId.make("project:questions");
const THREAD_ID = ThreadId.make("thread:question");
const REQUEST_ID = RuntimeRequestId.make("req-1");

const thread: OrchestrationV2AppThread = {
  createdBy: "user",
  creationSource: "web",
  id: THREAD_ID,
  projectId: QUESTIONS,
  title: "Why do volcanoes erupt?",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: MINE,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
  forkedFrom: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const approval = (
  requestKind: "command" | "file-change",
  prompt: string,
): OrchestrationV2TurnItem => ({
  threadId: THREAD_ID,
  runId: null,
  nodeId: "node:approval" as never,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: { driver: CLAUDE, nativeId: "tool-1", strength: "strong" as const },
  parentItemId: null,
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: NOW,
  id: TurnItemId.make("turn-item:runtime-request:req-1"),
  ordinal: 1,
  status: "waiting",
  type: "approval_request",
  requestId: REQUEST_ID,
  requestKind,
  prompt,
});

const commandCall = (input: string): OrchestrationV2TurnItem =>
  ({
    ...(approval("command", "") as object),
    id: TurnItemId.make("turn-item:provider:claudeAgent:native-item:tool-1"),
    ordinal: 0,
    status: "running",
    type: "command_execution",
    input,
  }) as OrchestrationV2TurnItem;

/** The gate with the Family profile on, over a Questions space and one question thread. */
const withQuestionGate = <A, E, R>(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  use: (input: {
    readonly gate: SkycotFamilyGate.SkycotFamilyGate["Service"];
    readonly family: SkycotFamily.SkycotFamily["Service"];
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-questions-gate-" });
    const layerProjections = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: () => Effect.succeed(thread),
        getTurnItem: ({ itemId }) =>
          Effect.succeed(items.find((item) => item.id === itemId) ?? null),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (projectId) =>
          Effect.succeed(
            projectId === QUESTIONS
              ? Option.some({ projectId, workspaceRoot: SPACE } as never)
              : projectId === "project:volcanoes"
                ? Option.some({ projectId, workspaceRoot: MINE } as never)
                : projectId === "project:games"
                  ? Option.some({ projectId, workspaceRoot: "/Users/kid/games" } as never)
                  : Option.none(),
          ),
        findActiveByWorkspaceRoot: (root) =>
          Effect.succeed(
            root === SPACE ? Option.some({ workspaceRoot: SPACE } as never) : Option.none(),
          ),
      }),
    );
    return yield* Effect.gen(function* () {
      const gate = yield* SkycotFamilyGate.SkycotFamilyGate;
      const family = yield* SkycotFamily.SkycotFamily;
      yield* family.enable({ code: CODE, childName: "Ava" });
      return yield* use({ gate, family });
    }).pipe(
      Effect.provide(
        SkycotFamilyGate.layerCore.pipe(
          Layer.provideMerge(
            SkycotFamilyLimits.layerAt(path.join(dir, SkycotFamilyLimits.ACTIVITY_FILE_NAME)),
          ),
          Layer.provideMerge(
            Layer.mergeAll(
              SkycotFamily.layerAt(path.join(dir, SkycotFamily.FAMILY_FILE_NAME)),
              layerProjections,
              SkycotQuestions.layerTest(SPACE),
            ),
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped);

const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(Effect.map((exit) => Exit.isFailure(exit)));

describe("gateNeedFor: Make this a project", () => {
  it("judges a new project by its folder", () => {
    assert.deepEqual(
      SkycotFamilyGate.gateNeedFor("projects.mutate", {
        type: "project.create",
        workspaceRoot: MINE,
      }),
      { type: "newProject", cwd: MINE },
    );
    // Without a folder it can only be some other folder: still a grown-up's.
    assert.deepEqual(SkycotFamilyGate.gateNeedFor("projects.mutate", { type: "project.create" }), {
      type: "grant",
      purpose: "openFolder",
    });
  });
});

it.layer(NodeServices.layer)("Family profile: a question is the child's own", (it) => {
  it.effect("starts a question and lets the child write in its own folder", () =>
    withQuestionGate([], ({ gate }) =>
      Effect.gen(function* () {
        const check = (method: string, payload: unknown) =>
          gate.check({ sessionId: SESSION, method, payload });
        // "Just ask": the engine picks the question's folder itself (root strategy).
        assert.isFalse(
          yield* refused(
            check(ORCHESTRATION_V2_WS_METHODS.launchThread, {
              projectId: QUESTIONS,
              threadId: THREAD_ID,
              workspaceStrategy: { type: "root" },
            }),
          ),
        );
        assert.isFalse(yield* refused(check("projects.ensureScratch", {})));
        const write = (cwd: string) =>
          check("projects.writeFile", { cwd, relativePath: ".gitignore", contents: "" });
        assert.isFalse(yield* refused(write(MINE)));
        assert.isTrue(yield* refused(write(`${SPACE}/../Documents`)));
        assert.isTrue(yield* refused(write("/Users/kid/Documents")));
        assert.isFalse(
          yield* refused(
            check(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
              type: "thread.create",
              worktreePath: MINE,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("Make this a project: open for a question's folder, a grown-up's anywhere else", () =>
    withQuestionGate([], ({ gate, family }) =>
      Effect.gen(function* () {
        const create = (workspaceRoot: string) =>
          gate.check({
            sessionId: SESSION,
            method: "projects.mutate",
            payload: { type: "project.create", projectId: "p", title: "Volcanoes", workspaceRoot },
          });
        const createHttp = (workspaceRoot: string) =>
          gate.checkHttp({
            sessionId: SESSION,
            method: "POST",
            pathname: "/api/projects/mutate",
            payload: { type: "project.create", projectId: "p", title: "x", workspaceRoot },
          });
        assert.isFalse(yield* refused(create(MINE)));
        assert.isFalse(yield* refused(createHttp(MINE)));
        // The space itself, a path that climbs out, and the person's folders are not questions.
        assert.isTrue(yield* refused(create(SPACE)));
        assert.isTrue(yield* refused(create(`${MINE}/../../../Documents`)));
        assert.isTrue(yield* refused(create("/Users/kid/Documents/homework")));
        assert.isTrue(yield* refused(createHttp("/Users/kid/Documents/homework")));
        // Moving a project's folder is still opening another folder.
        assert.isTrue(
          yield* refused(
            gate.check({
              sessionId: SESSION,
              method: "projects.mutate",
              payload: { type: "project.update", projectId: "p", workspaceRoot: MINE },
            }),
          ),
        );
        yield* family.verify({ code: CODE, purpose: "openFolder", sessionId: SESSION });
        assert.isFalse(yield* refused(create("/Users/kid/Documents/homework")));
      }),
    ),
  );

  it.effect("Undo of Make this a project: a question's project comes off the list, no other", () =>
    withQuestionGate([], ({ gate }) =>
      Effect.gen(function* () {
        const remove = (projectId: string, force?: boolean) =>
          gate.check({
            sessionId: SESSION,
            method: "projects.mutate",
            payload: {
              type: "project.delete",
              commandId: "c",
              projectId,
              ...(force === undefined ? {} : { force }),
            },
          });
        assert.isFalse(yield* refused(remove("project:volcanoes")));
        assert.isTrue(yield* refused(remove("project:volcanoes", true)));
        assert.isTrue(yield* refused(remove("project:games")));
        assert.isTrue(yield* refused(remove(QUESTIONS)));
        assert.isTrue(yield* refused(remove("project:unknown")));
      }),
    ),
  );

  it.effect("lets the child allow an edit in the question's own folder", () =>
    withQuestionGate([approval("file-change", `add ${MINE}/volcano.html`)], ({ gate }) =>
      Effect.gen(function* () {
        assert.isFalse(
          yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
        );
        assert.isFalse(
          yield* refused(
            gate.check({
              sessionId: SESSION,
              method: ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
              payload: {
                type: "runtime-request.respond",
                commandId: "c",
                threadId: THREAD_ID,
                requestId: REQUEST_ID,
                decision: "accept",
              },
            }),
          ),
        );
      }),
    ),
  );

  it.effect("a sibling's question is somebody else's folder", () =>
    withQuestionGate([approval("file-change", `Edit ${SISTERS}/index.html`)], ({ gate }) =>
      Effect.gen(function* () {
        assert.isTrue(
          yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
        );
      }),
    ),
  );

  it.effect("installs still need the parent code inside a question", () =>
    withQuestionGate(
      [approval("command", "Install three.js"), commandCall("npm install three")],
      ({ gate }) =>
        Effect.gen(function* () {
          assert.isTrue(
            yield* gate.requestNeedsGrownUp({ threadId: THREAD_ID, requestId: REQUEST_ID }),
          );
        }),
    ),
  );
});

describe("keepVersions", () => {
  const fakeGit = (calls: Array<ReadonlyArray<string>>, fail = false) =>
    ({
      execute: (input: { readonly args: ReadonlyArray<string> }) => {
        calls.push(input.args);
        return fail
          ? Effect.fail({ message: "git: command not found" } as never)
          : Effect.succeed({ exitCode: 0, stdout: "", stderr: "" } as never);
      },
    }) as unknown as GitVcsDriver.GitVcsDriver["Service"];

  const withPolicy = <A>(value: string | undefined, run: () => A): A => {
    const previous = process.env[SKYCOT_POLICY_ENV];
    if (value === undefined) delete process.env[SKYCOT_POLICY_ENV];
    else process.env[SKYCOT_POLICY_ENV] = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env[SKYCOT_POLICY_ENV];
      else process.env[SKYCOT_POLICY_ENV] = previous;
    }
  };

  it.effect("starts keeping versions in a new question's folder, in SKYCOT only", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const folder = Option.some(MINE);
      const kept = yield* withPolicy("1", () =>
        SkycotQuestions.keepVersions(fakeGit(calls), folder),
      );
      assert.deepEqual(kept, folder);
      assert.deepEqual(calls, [["init", "--quiet", "--initial-branch=main"]]);
      // T3's own Scratch (no SKYCOT policy) stays a plain folder.
      yield* withPolicy(undefined, () => SkycotQuestions.keepVersions(fakeGit(calls), folder));
      assert.equal(calls.length, 1);
      yield* withPolicy("1", () => SkycotQuestions.keepVersions(fakeGit(calls), Option.none()));
      assert.equal(calls.length, 1);
    }),
  );

  it.effect("a Mac without Git still gets its question, only without versions", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const kept = yield* withPolicy("1", () =>
        SkycotQuestions.keepVersions(fakeGit(calls, true), Option.some(MINE)),
      );
      assert.deepEqual(kept, Option.some(MINE));
    }),
  );
});

describe("the recap: a question is a message, and a thing made only once it made a file", () => {
  const at = (iso: string) => Date.parse(iso);
  const day = at("2026-10-23T18:00:00+11:00");
  const activity: ActivitySnapshot = {
    threads: { "thread:ask": "ava", "thread:page": "ava" },
    projects: {},
    days: {
      ava: {
        date: "2026-10-23",
        minutes: 12,
        lastMinute: null,
        turns: 2,
        passUntil: null,
        bedtimeSkippedUntil: null,
      },
    },
    history: {},
    log: [],
    events: [],
  };
  const question = (
    threadId: string,
    overrides: Partial<RecapThreadInput> = {},
  ): RecapThreadInput => ({
    threadId,
    projectId: "project:questions",
    projectTitle: "Questions",
    title: "Why is the sky blue?",
    createdAt: at("2026-10-23T15:00:00+11:00"),
    cwd: `${SPACE}/${threadId}`,
    question: true,
    messages: [
      {
        id: `${threadId}:m1`,
        createdBy: "user",
        text: "Why is the sky blue?",
        createdAt: at("2026-10-23T15:00:00+11:00"),
      },
    ],
    checkpoints: [],
    runs: [{ id: "run-1", status: "completed" }],
    heldAt: [],
    ...overrides,
  });

  it("counts both, lists only the one that made a page", () => {
    const recap = buildRecap({
      childId: "ava",
      range: "session",
      now: day,
      timeZone: "Australia/Melbourne",
      activity,
      threads: [
        question("thread:ask"),
        question("thread:page", {
          title: "A volcano page",
          checkpoints: [
            {
              id: "cp-1",
              runId: "run-1",
              capturedAt: at("2026-10-23T15:05:00+11:00"),
              files: [{ path: "volcano.html", kind: "added", additions: 30, deletions: 0 }],
            },
          ],
        }),
      ],
    });
    assert.deepEqual(
      recap.made.map((made) => made.threadId),
      ["thread:page"],
    );
    assert.equal(recap.made[0]!.projectTitle, "Questions");
    assert.equal(recap.messages, 2);
    assert.deepEqual(recap.asks.map((ask) => ask.threadId).sort(), ["thread:ask", "thread:page"]);
  });
});
