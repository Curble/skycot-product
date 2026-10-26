// Just ask, one space per child (24 October 2026). With the Family profile on, each child's
// questions live in a Questions space of their own, `<scratch>/children/<childId>`: a project
// like their others, owned by that child (the owner follows from the folder, see
// `questionsSpaceOwners` in @t3tools/skycot-rules/questions), with every question in a folder of
// its own inside it (ManagedProjectFolders, seam `skycot-questions-per-child`).
//
// The engine answers `projects.ensureScratch` ("open Questions") with the space of the child
// using SKYCOT on that session (SkycotFamilyGate.layerRpcAuthorization): a child's own device
// always gets its child's, the family's Mac the child picked in "Who's using SKYCOT?". With the
// profile off, or nobody picked, T3's own Scratch project answers as before.
//
// Nothing that exists is moved: T3's Scratch project (the shared space) keeps the questions
// asked before, each still its asker's, and the new folder is made for new questions only.
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { childQuestionsFolder, childQuestionsLabel } from "@t3tools/skycot-rules/questions";

import {
  ManagedProjectFolders,
  ScratchFolderError,
  ScratchProjectError,
} from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as SkycotProjectMemory from "../SkycotProjectMemory.ts"; // nondev-seam: skycot-project-memory

export class SkycotQuestionSpaces extends Context.Service<
  SkycotQuestionSpaces,
  {
    /**
     * The child's own Questions space, made on first use. None when this Mac has no Questions
     * space at all (its data folder is inside a Git checkout), or for an id that is no child's.
     */
    readonly ensureChildSpace: (input: {
      readonly childId: string;
      /** For the project's title ("Ava's questions"); the clients label it from the profile. */
      readonly childName: string | null;
    }) => Effect.Effect<
      Option.Option<{ readonly projectId: ProjectId }>,
      ScratchFolderError | ScratchProjectError
    >;
  }
>()("t3/skycot/questions/SkycotQuestionSpaces") {}

/** The same icon T3 gives its Scratch project, so every Questions space looks alike. */
const QUESTIONS_ICON = { kind: "lucide", name: "message-square-dashed", color: "gray" } as const;

const make = Effect.gen(function* () {
  const folders = yield* ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const projectMemory = yield* Effect.serviceOption(SkycotProjectMemory.SkycotProjectMemory);

  const ensureChildSpace: SkycotQuestionSpaces["Service"]["ensureChildSpace"] = Effect.fn(
    "SkycotQuestionSpaces.ensureChildSpace",
  )(function* (input) {
    const root = yield* folders.scratchRoot;
    if (Option.isNone(root)) return Option.none();
    const workspaceRoot = childQuestionsFolder(root.value, input.childId);
    if (workspaceRoot === null) return Option.none();
    yield* fs
      .makeDirectory(workspaceRoot, { recursive: true })
      .pipe(Effect.mapError((cause) => new ScratchFolderError({ folder: workspaceRoot, cause })));
    const fail = (cause: unknown) => new ScratchProjectError({ workspaceRoot, cause });
    const id = yield* crypto.randomUUIDv4().pipe(Effect.mapError(fail));
    const title = input.childName ? childQuestionsLabel(input.childName) : "Questions";
    const bootstrapped = yield* projects
      .bootstrap({
        commandId: CommandId.make(`skycot-questions:${input.childId}:${id}`),
        projectId: ProjectId.make(id),
        title,
        workspaceRoot,
      })
      .pipe(
        // Two of the child's devices opening Questions at once: the loser names the winner.
        Effect.catchTags({
          ProjectConflictError: (conflict) =>
            Effect.succeed({
              project: { id: conflict.conflictingProjectId, title },
              created: false,
            }),
        }),
        Effect.mapError(fail),
      );
    const projectId = bootstrapped.project.id;
    if (bootstrapped.created) {
      if (projectMemory._tag === "Some") {
        yield* projectMemory.value.recordCreatedFolder({
          path: workspaceRoot,
          childId: input.childId,
        });
      }
      yield* projects
        .update({
          commandId: CommandId.make(`skycot-questions-icon:${id}`),
          projectId,
          projectIcon: QUESTIONS_ICON,
        })
        .pipe(Effect.mapError(fail));
    } else if (input.childName && bootstrapped.project.title !== title) {
      // Renamed in Settings › Family since: the title follows (the clients label from the
      // profile anyway; this keeps T3's own screens and a grown-up's phone in step).
      yield* projects
        .update({ commandId: CommandId.make(`skycot-questions-title:${id}`), projectId, title })
        .pipe(Effect.ignore);
    }
    return Option.some({ projectId });
  });

  return SkycotQuestionSpaces.of({ ensureChildSpace });
});

export const layer = Layer.effect(SkycotQuestionSpaces, make);
