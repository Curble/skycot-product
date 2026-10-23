// Just ask, one space per child, over the engine's real project store and Scratch folders: a
// child's space is made once (`<scratch>/children/<childId>`), every question asked in it gets
// its own folder there (seam skycot-questions-per-child), and T3's own Scratch project, with
// the questions already in it, is left exactly as it was.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { childQuestionsFolder, questionsSpaceOf } from "@t3tools/skycot-rules/questions";

import * as ServerConfig from "../../config.ts";
import * as GitManager from "../../git/GitManager.ts";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import * as RuntimeLayer from "../../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectEnrichmentService from "../../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { SKYCOT_POLICY_ENV } from "../SkycotPolicy.ts";
import * as SkycotQuestionSpaces from "./SkycotQuestionSpaces.ts";

const AVA = "c0a0a0a0a0a";
const LEO = "c1e01e01e01";

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
);

const layerEngine = (baseDir: string) =>
  SkycotQuestionSpaces.layer.pipe(
    Layer.provideMerge(ManagedProjectFolders.layer),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(
      GitWorkflow.layer.pipe(
        Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
        Layer.provide(Layer.mock(GitManager.GitManager)({})),
      ),
    ),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(NodeCrypto.layer),
    Layer.provideMerge(NodeServices.layer),
  );

/** SKYCOT's policy flag on for the body (questions keep versions, children's spaces apply). */
const withPolicy = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[SKYCOT_POLICY_ENV];
      process.env[SKYCOT_POLICY_ENV] = "1";
      return previous;
    }),
    () => body,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[SKYCOT_POLICY_ENV];
        else process.env[SKYCOT_POLICY_ENV] = previous;
      }),
  );

const withEngine = <A, E>(
  body: (baseDir: string) => Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerEngine>>>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "skycot-question-spaces-" });
    return yield* withPolicy(body(baseDir).pipe(Effect.provide(layerEngine(baseDir))));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("each child gets a space of their own, made once, beside T3's Scratch", () =>
  withEngine(() =>
    Effect.gen(function* () {
      const spaces = yield* SkycotQuestionSpaces.SkycotQuestionSpaces;
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const fs = yield* FileSystem.FileSystem;
      const root = Option.getOrThrow(yield* folders.scratchRoot);

      const ava = Option.getOrThrow(
        yield* spaces.ensureChildSpace({ childId: AVA, childName: "Ava" }),
      );
      const leo = Option.getOrThrow(
        yield* spaces.ensureChildSpace({ childId: LEO, childName: "Leo" }),
      );
      assert.notEqual(ava.projectId, leo.projectId);
      // Asking again (another device, a reload) finds the same space.
      const again = Option.getOrThrow(
        yield* spaces.ensureChildSpace({ childId: AVA, childName: "Ava" }),
      );
      assert.equal(again.projectId, ava.projectId);

      const avaProject = Option.getOrThrow(yield* projects.getById(ava.projectId));
      assert.equal(avaProject.workspaceRoot, childQuestionsFolder(root, AVA));
      assert.equal(avaProject.title, "Ava's questions");
      assert.deepEqual(questionsSpaceOf(avaProject.workspaceRoot, root), {
        kind: "child",
        childId: AVA,
      });
      assert.isTrue(yield* fs.exists(avaProject.workspaceRoot));

      // A renamed child: the space keeps its folder, and its title follows the new name.
      yield* spaces.ensureChildSpace({ childId: AVA, childName: "Avery" });
      assert.equal(
        Option.getOrThrow(yield* projects.getById(ava.projectId)).title,
        "Avery's questions",
      );
      // An id that is no child's makes nothing.
      assert.isTrue(
        Option.isNone(yield* spaces.ensureChildSpace({ childId: "../escape", childName: "X" })),
      );
    }),
  ),
);

it.effect(
  "a question asked in a child's space gets its own folder in that space, with versions",
  () =>
    withEngine(() =>
      Effect.gen(function* () {
        const spaces = yield* SkycotQuestionSpaces.SkycotQuestionSpaces;
        const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = Option.getOrThrow(yield* folders.scratchRoot);

        const ava = Option.getOrThrow(
          yield* spaces.ensureChildSpace({ childId: AVA, childName: "Ava" }),
        );
        const folder = Option.getOrThrow(
          yield* folders.folderForThread({
            projectId: ava.projectId,
            threadId: ThreadId.make("thread:volcano"),
            text: "Why do volcanoes erupt?",
          }),
        );
        assert.equal(path.dirname(folder), childQuestionsFolder(root, AVA));
        assert.match(path.basename(folder), /^\d{4}-\d{2}-\d{2}-why-do-volcanoes-erupt-/);
        // Undo and "What changed" need a repository in the question's own folder.
        assert.isTrue(yield* fs.exists(path.join(folder, ".git")));
      }),
    ),
);

it.effect("T3's Scratch project and the questions already in it are left as they were", () =>
  withEngine(() =>
    Effect.gen(function* () {
      const spaces = yield* SkycotQuestionSpaces.SkycotQuestionSpaces;
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = Option.getOrThrow(yield* folders.scratchRoot);

      // A question from before (the shared space), with its Undo history.
      const shared = yield* folders.ensureScratchProject;
      const earlier = Option.getOrThrow(
        yield* folders.folderForThread({
          projectId: shared.projectId,
          threadId: ThreadId.make("thread:pony"),
          text: "Make a pony page",
        }),
      );
      assert.equal(path.dirname(earlier), root);
      yield* fs.writeFileString(path.join(earlier, "pony.html"), "<h1>Pony</h1>");

      // Children's spaces arrive later; nothing that was there moves.
      yield* spaces.ensureChildSpace({ childId: AVA, childName: "Ava" });
      yield* spaces.ensureChildSpace({ childId: LEO, childName: "Leo" });
      assert.isTrue(yield* fs.exists(path.join(earlier, ".git")));
      assert.equal(yield* fs.readFileString(path.join(earlier, "pony.html")), "<h1>Pony</h1>");
      assert.equal((yield* folders.ensureScratchProject).projectId, shared.projectId);
      // A new question in the shared space still lands in the shared space (the profile off).
      const next = Option.getOrThrow(
        yield* folders.folderForThread({
          projectId: shared.projectId,
          threadId: ThreadId.make("thread:sky"),
          text: "Why is the sky blue?",
        }),
      );
      assert.equal(path.dirname(next), root);
      // Some other project is no Questions space: no folder is made for it.
      assert.isTrue(
        Option.isNone(
          yield* folders.folderForThread({
            projectId: ProjectId.make("project:not-there"),
            threadId: ThreadId.make("thread:x"),
            text: "x",
          }),
        ),
      );
    }),
  ),
);
