// @effect-diagnostics nodeBuiltinImport:off
// Installed add-ons stay out of the versions: after SKYCOT's exclude step, a real Git folder
// with `node_modules/x/index.js` and a page the child made checkpoints, and "What changed"
// lists, only the page. The engine's own checkpoint code does the capturing here, unchanged.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { parseTurnDiffFilesFromNumstat } from "../../checkpointing/Diffs.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { gitThroughRunner } from "../SkycotApprovedInstalls.ts";
import { SKYCOT_POLICY_ENV } from "../SkycotPolicy.ts";
import {
  KEEP_OUT_OF_VERSIONS,
  keepAddOnsOutOfVersions,
  withKeptOut,
} from "./SkycotKeepOutOfVersions.ts";
import * as SkycotQuestions from "./SkycotQuestions.ts";

const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const layerTest = Layer.mergeAll(
  CheckpointStore.layer.pipe(
    Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(layerVcsProcess))),
  ),
  GitVcsDriver.layer.pipe(
    Layer.provide(
      ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-skycot-keep-out-" }),
    ),
  ),
  ProcessRunner.layer,
).pipe(Layer.provideMerge(layerVcsProcess), Layer.provideMerge(NodeServices.layer));

const write = (folder: string, file: string, text: string) => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(folder, file)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(folder, file), text);
};
const exclude = (folder: string) =>
  NodeFS.readFileSync(NodePath.join(folder, ".git", "info", "exclude"), "utf8");

/** keepVersions as SKYCOT runs it: with the policy on, read when the effect is made. */
const keepVersionsInSkycot = (git: GitVcsDriver.GitVcsDriver["Service"], folder: string) => {
  const previous = process.env[SKYCOT_POLICY_ENV];
  process.env[SKYCOT_POLICY_ENV] = "1";
  try {
    return SkycotQuestions.keepVersions(git, Option.some(folder));
  } finally {
    if (previous === undefined) delete process.env[SKYCOT_POLICY_ENV];
    else process.env[SKYCOT_POLICY_ENV] = previous;
  }
};

describe("withKeptOut", () => {
  it("adds SKYCOT's lines once, keeping what was there", () => {
    const gitDefault = "# git ls-files --others --exclude-from=.git/info/exclude\n# *~\n";
    const added = withKeptOut(gitDefault);
    assert.isNotNull(added);
    assert.isTrue(added!.startsWith(gitDefault));
    for (const pattern of KEEP_OUT_OF_VERSIONS) assert.include(added!.split("\n"), pattern);
    assert.isNull(withKeptOut(added!));
    // A file without a final newline keeps its last line whole.
    assert.isTrue(withKeptOut("build/")!.startsWith("build/\n"));
    // Only the missing lines are added.
    const partial = withKeptOut("node_modules/\n")!;
    assert.equal(partial.split("\n").filter((line) => line === "node_modules/").length, 1);
  });
});

it.layer(layerTest)("installed add-ons stay out of the versions", (it) => {
  it.effect("a new question's folder checkpoints and lists only what the child made", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-question-" });
      const git = yield* GitVcsDriver.GitVcsDriver;
      const store = yield* CheckpointStore.CheckpointStore;

      yield* keepVersionsInSkycot(git, folder);
      assert.include(exclude(folder), "node_modules/");
      // Nothing visible is written into the child's project.
      assert.deepEqual(NodeFS.readdirSync(folder), [".git"]);

      const threadId = ThreadId.make("thread-skycot-keep-out");
      const before = checkpointRefForThreadTurn(threadId, 0);
      const after = checkpointRefForThreadTurn(threadId, 1);
      yield* store.captureCheckpoint({ cwd: folder, checkpointRef: before });
      write(folder, "node_modules/x/index.js", "module.exports = 1;\n");
      write(folder, "node_modules/x/package.json", '{"name":"x"}\n');
      write(folder, "__pycache__/tool.cpython-312.pyc", "cache\n");
      write(folder, ".DS_Store", "finder\n");
      write(folder, "index.html", "<h1>My volcano</h1>\n");
      yield* store.captureCheckpoint({ cwd: folder, checkpointRef: after });

      // The change list ("What changed", the Versions panel) is the engine's numstat diff.
      const numstat = yield* store.diffCheckpoints({
        cwd: folder,
        fromCheckpointRef: before,
        toCheckpointRef: after,
        ignoreWhitespace: false,
        format: "numstat",
      });
      assert.deepEqual(
        parseTurnDiffFilesFromNumstat(numstat).map((file) => file.path),
        ["index.html"],
      );
      // And the version itself holds only the page.
      const tree = yield* git.execute({
        operation: "test.ls-tree",
        cwd: folder,
        args: ["ls-tree", "-r", "--name-only", `${after}^{commit}`],
      });
      assert.deepEqual(tree.stdout.trim().split("\n"), ["index.html"]);

      // Undo to before the turn takes the page away and leaves the installed add-on alone.
      yield* store.restoreCheckpoint({ cwd: folder, checkpointRef: before });
      assert.isFalse(NodeFS.existsSync(NodePath.join(folder, "index.html")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(folder, "node_modules/x/index.js")));
    }),
  );

  it.effect(
    "an older folder gets it before an install, once, and a repo that ignores it already is left alone",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const git = yield* GitVcsDriver.GitVcsDriver;
        const runner = yield* ProcessRunner.ProcessRunner;
        const plainInit = (folder: string) =>
          git.execute({ operation: "test.init", cwd: folder, args: ["init", "--quiet"] });

        const older = yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-older-" });
        yield* plainInit(older);
        const keep = () =>
          keepAddOnsOutOfVersions(gitThroughRunner(runner, older), older, { unlessIgnored: true });
        assert.equal(yield* keep(), "added");
        const once = exclude(older);
        assert.equal(yield* keep(), "already");
        assert.equal(exclude(older), once);
        assert.isFalse(NodeFS.existsSync(NodePath.join(older, ".gitignore")));

        const ownIgnore = yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-own-" });
        yield* plainInit(ownIgnore);
        write(ownIgnore, ".gitignore", "node_modules\n");
        const untouched = exclude(ownIgnore);
        const ownOutcome = yield* keepAddOnsOutOfVersions(
          gitThroughRunner(runner, ownIgnore),
          ownIgnore,
          { unlessIgnored: true },
        );
        assert.equal(ownOutcome, "already");
        assert.equal(exclude(ownIgnore), untouched);

        const noRepo = yield* fileSystem.makeTempDirectoryScoped({ prefix: "skycot-norepo-" });
        const noRepoOutcome = yield* keepAddOnsOutOfVersions(
          gitThroughRunner(runner, noRepo),
          noRepo,
          { unlessIgnored: true },
        );
        assert.equal(noRepoOutcome, "not-a-repo");
        assert.deepEqual(NodeFS.readdirSync(noRepo), []);
      }),
  );
});
