// "Just ask" (a conversation without a project), engine side. T3 already has the space: its
// Scratch project at `<home>/scratch`, where every conversation gets a folder of its own
// (ManagedProjectFolders.folderForThread). SKYCOT adds three things on top:
//
//   - each question's folder keeps versions (`git init`), so the engine's checkpoints work
//     there: "What changed", Undo, the fridge and the recap see what a question made;
//   - the Family gate and the policy reactor treat a question as its own small project
//     (`workRootsFor`): its folder is open to the child, every other folder, a sibling's
//     question included, is outside;
//   - "Make this a project" is a `project.create` of the question's own folder, which the
//     Family gate lets the child do (it is SKYCOT's own space, not the person's folders).
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import type * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import { isSkycotPolicyEnabled } from "../SkycotPolicy.ts";

export class SkycotQuestions extends Context.Service<
  SkycotQuestions,
  {
    /** The Questions space (T3's Scratch folder); null for none. Tests provide it. */
    readonly questionsRoot: string | null;
  }
>()("t3/skycot/questions/SkycotQuestions") {}

export const layerTest = (questionsRoot: string | null) =>
  Layer.succeed(SkycotQuestions, SkycotQuestions.of({ questionsRoot }));

/**
 * The space: the test override when one is provided, else the engine's own from its config;
 * null when neither is around (older tests and tools). Read it once where a service is built,
 * since a call's own context does not carry either.
 */
export const questionsRootOption = Effect.gen(function* () {
  const override = yield* Effect.serviceOption(SkycotQuestions);
  if (Option.isSome(override)) return override.value.questionsRoot;
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const path = yield* Effect.serviceOption(Path.Path);
  if (Option.isNone(config) || Option.isNone(path)) return null;
  // Where T3 keeps its Scratch project (ManagedProjectFolders: `<baseDir>/scratch`).
  return path.value.resolve(config.value.baseDir, "scratch");
});

/**
 * Called by ManagedProjectFolders right after it claims a question's folder (seam
 * `skycot-questions-history`): start keeping versions there, before the first turn's baseline
 * checkpoint. Only in SKYCOT (the policy flag), so upstream's own Scratch stays a plain
 * folder. Best effort: without Git the question still works, only without Undo.
 */
export const keepVersions = (
  git: GitVcsDriver.GitVcsDriver["Service"],
  folder: Option.Option<string>,
): Effect.Effect<Option.Option<string>> =>
  Option.isNone(folder) || !isSkycotPolicyEnabled(process.env)
    ? Effect.succeed(folder)
    : git
        .execute({
          operation: "SkycotQuestions.keepVersions",
          cwd: folder.value,
          args: ["init", "--quiet", "--initial-branch=main"],
          timeoutMs: 10_000,
        })
        .pipe(
          Effect.tapError((error) =>
            Effect.logWarning("skycot-questions.init-failed", { reason: error.message }),
          ),
          Effect.ignore,
          Effect.as(folder),
        );
