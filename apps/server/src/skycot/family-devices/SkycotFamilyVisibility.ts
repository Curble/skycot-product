// Per-person visibility, engine side (decision 5): a child's own device sees only that child's
// conversations and projects, plus the pages pinned to the family fridge. Grown-ups' devices and
// the family's Mac see everything, as before.
//
// Enforced in four places, all in the engine:
// - every WebSocket call that names a conversation, project or folder (SkycotFamilyGate.check);
// - the live shell lists, which a child's device receives filtered (seam skycot-family-visibility
//   in ws.ts), and the archived list's snapshot (the gate's result filter);
// - the HTTP reads that name one (`/api/orchestration/threads/:id/*`, Files, previews, the fridge)
//   and the HTTP lists, whose answers are filtered (SkycotFamilyHttp.layerApiGate).
//
// What counts as the child's: a conversation the engine recorded them starting, and a project
// they started or that nobody owns (a family project). A conversation with no recorded owner
// that already exists (older ones, a grown-up's) stays off the child's device; a brand-new id is
// the child's own new conversation, recorded as theirs when it starts.
//
// Questions spaces are judged by their folder, whatever was recorded (Just ask per child): a
// child's space (`<scratch>/children/<childId>`) is that child's, and the shared space (T3's
// Scratch, the questions from before) is the grown-ups', so a child's device lists it only while
// it holds questions of their own.

// The fridge's pins are read as plain JSON of any shape (only their keys matter here).
// @effect-diagnostics preferSchemaOverJson:off
import type {
  OrchestrationV2ArchivedShellStreamItem,
  OrchestrationV2ShellStreamItem,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { childSeesProject } from "@t3tools/skycot-rules/people";
import { questionsSpaceOwners } from "@t3tools/skycot-rules/questions";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { FRIDGE_FILE_NAME } from "../family-fridge/SkycotFridge.ts";
import * as SkycotFamilyLimits from "../family-limits/SkycotFamilyLimits.ts";
import * as SkycotQuestions from "../questions/SkycotQuestions.ts";
import * as SkycotFamilyIdentity from "./SkycotFamilyIdentity.ts";
import * as SkycotFamily from "../SkycotFamily.ts";
import {
  archivedItemVisible,
  folderOwner,
  makeShellItemFilter,
  referencedBy,
  type ChildView,
  type Referenced,
} from "./visibility.ts";

export type { ChildView, Referenced };

/**
 * "use": the call works on it (open, send, subscribe, write); "read": it only reads a file, where
 * a page pinned to the fridge stays open to every child.
 */
export type VisibilityMode = "use" | "read";

export class SkycotFamilyVisibility extends Context.Service<
  SkycotFamilyVisibility,
  {
    /** The child view for a child's own device; null where everything is visible. */
    readonly childViewFor: (sessionId: string) => Effect.Effect<ChildView | null>;
    /** Thread ids a child may search; fridge pins from siblings are deliberately excluded. */
    // nondev-seam: skycot-child-thread-search
    readonly searchableThreadIds: (
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<ThreadId> | null>;
    /** Whether a child's device may use everything a call names. */
    readonly allows: (
      view: ChildView,
      referenced: Referenced,
      mode: VisibilityMode,
    ) => Effect.Effect<boolean>;
    /** The shell's live list, as this session may see it. */
    readonly filterShellStream: <E, R>(
      sessionId: string,
      stream: Stream.Stream<OrchestrationV2ShellStreamItem, E, R>,
    ) => Stream.Stream<OrchestrationV2ShellStreamItem, E, R>;
    /** The archived list's live items, as this session may see them. */
    readonly filterArchivedStream: <E, R>(
      sessionId: string,
      stream: Stream.Stream<OrchestrationV2ArchivedShellStreamItem, E, R>,
    ) => Stream.Stream<OrchestrationV2ArchivedShellStreamItem, E, R>;
  }
>()("t3/skycot/family-devices/SkycotFamilyVisibility") {}

const readPins = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.readFileString(filePath).pipe(
    Effect.map((raw): ReadonlySet<string> => {
      try {
        const parsed = JSON.parse(raw) as { readonly pins?: Record<string, unknown> };
        return new Set(Object.keys(parsed.pins ?? {}));
      } catch {
        return new Set();
      }
    }),
    Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
  );

const makeAt = Effect.fn("SkycotFamilyVisibility.make")(function* (pinsFile: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const identity = yield* SkycotFamilyIdentity.SkycotFamilyIdentity;
  const family = yield* SkycotFamily.SkycotFamily;
  const limits = yield* SkycotFamilyLimits.SkycotFamilyLimits;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const questionsRoot = yield* SkycotQuestions.questionsRootOption;

  /** Who owns each project: as recorded, with every Questions space's owner read from its folder. */
  const projectOwners = Effect.fnUntraced(function* (recorded: Readonly<Record<string, string>>) {
    if (questionsRoot === null) return recorded;
    const list = yield* projects.list().pipe(Effect.orElseSucceed(() => []));
    const spaces = questionsSpaceOwners(
      list.map((project) => ({
        projectId: String(project.projectId),
        workspaceRoot: project.workspaceRoot,
      })),
      questionsRoot,
    );
    return Object.keys(spaces).length === 0 ? recorded : { ...recorded, ...spaces };
  });

  const childViewFor: SkycotFamilyVisibility["Service"]["childViewFor"] = Effect.fn(
    "SkycotFamilyVisibility.childViewFor",
  )(function* (sessionId) {
    const who = yield* identity.identify(sessionId);
    // A grown-up in grown-up mode on the Mac (code entered: settings, advanced or the session) sees everything.
    if (who.kind === "shared" && (yield* family.allows({ sessionId, purpose: "settings" }))) {
      return null;
    }
    const childId =
      who.kind === "child"
        ? who.childId
        : who.kind === "shared"
          ? (yield* limits.forSession({ sessionId })).childId
          : null;
    if (childId === null) return null;
    const today = yield* limits.today;
    return {
      childId,
      owners: { threads: today.threads, projects: yield* projectOwners(today.projects) },
      pinned: yield* readPins(fs, pinsFile),
      ...(who.kind === "shared" ? { sharedSession: true } : {}),
    } satisfies ChildView;
  });

  const searchableThreadIds: SkycotFamilyVisibility["Service"]["searchableThreadIds"] = Effect.fn(
    "SkycotFamilyVisibility.searchableThreadIds",
  )(function* (sessionId) {
    const view = yield* childViewFor(sessionId);
    if (view === null) return null;
    return Object.entries(view.owners.threads)
      .filter(([, owner]) => owner === view.childId)
      .map(([threadId]) => threadId as ThreadId);
  });

  /** A conversation id the engine has never seen is a new one the child is starting. */
  const threadExists = (threadId: string) =>
    projections.getThreadShell(threadId as ThreadId).pipe(
      Effect.map((shell) => shell !== null),
      // A failed read keeps it closed (the safe side).
      Effect.orElseSucceed(() => true),
    );

  const threadAllowed = Effect.fnUntraced(function* (
    view: ChildView,
    threadId: string,
    mode: VisibilityMode,
  ) {
    const owner = view.owners.threads[threadId];
    if (owner === view.childId) return true;
    // A page pinned to the family fridge is readable by every child, on the Mac too; never writable.
    if (mode === "read" && view.pinned.has(threadId)) return true;
    if (view.sharedSession && owner === undefined) return true;
    if (owner !== undefined) return false;
    return !(yield* threadExists(threadId));
  });

  /** The projects the child's own conversations are in, looked up only when it matters. */
  const ownThreadProjects = Effect.fnUntraced(function* (view: ChildView) {
    const own = Object.entries(view.owners.threads)
      .filter(([, childId]) => childId === view.childId)
      .map(([threadId]) => threadId);
    const found = new Set<string>();
    for (const threadId of own) {
      const thread = yield* projections
        .getThread(threadId as ThreadId)
        .pipe(Effect.orElseSucceed(() => null));
      if (thread !== null) found.add(thread.projectId);
    }
    return found;
  });

  const projectAllowed = Effect.fnUntraced(function* (view: ChildView, projectId: string) {
    if (view.sharedSession) return childSeesProject(view.childId, projectId, view.owners);
    if (childSeesProject(view.childId, projectId, view.owners)) return true;
    return childSeesProject(view.childId, projectId, view.owners, yield* ownThreadProjects(view));
  });

  const realOr = (folder: string) =>
    fs.realPath(folder).pipe(Effect.orElseSucceed(() => path.resolve(folder)));

  const folderAllowed = Effect.fnUntraced(function* (
    view: ChildView,
    folder: string,
    mode: VisibilityMode,
  ) {
    const threads = yield* projections
      .getThreadWorktreePaths({ includeArchived: true })
      .pipe(Effect.orElseSucceed(() => []));
    const projectList = yield* projects.list().pipe(Effect.orElseSucceed(() => []));
    const known = {
      threads: yield* Effect.forEach(threads, (entry) =>
        realOr(entry.worktreePath).pipe(
          Effect.map((worktreePath) => ({ threadId: String(entry.threadId), worktreePath })),
        ),
      ),
      projects: yield* Effect.forEach(projectList, (project) =>
        realOr(project.workspaceRoot).pipe(
          Effect.map((workspaceRoot) => ({ projectId: String(project.projectId), workspaceRoot })),
        ),
      ),
    };
    const owner = folderOwner(yield* realOr(folder), known, path.sep);
    if (owner === null) return true;
    return owner.type === "thread"
      ? yield* threadAllowed(view, owner.id, mode)
      : yield* projectAllowed(view, owner.id);
  });

  const allows: SkycotFamilyVisibility["Service"]["allows"] = Effect.fn(
    "SkycotFamilyVisibility.allows",
  )(function* (view, referenced, mode) {
    for (const threadId of referenced.threadIds) {
      if (!(yield* threadAllowed(view, threadId, mode))) return false;
    }
    for (const projectId of referenced.projectIds) {
      if (!(yield* projectAllowed(view, projectId))) return false;
    }
    for (const folder of referenced.folders) {
      if (!(yield* folderAllowed(view, folder, mode))) return false;
    }
    return true;
  });

  const filterShellStream: SkycotFamilyVisibility["Service"]["filterShellStream"] = (
    sessionId,
    stream,
  ) =>
    Stream.unwrap(
      Effect.sync(() => {
        const filter = makeShellItemFilter();
        return stream.pipe(
          Stream.mapEffect((item) =>
            childViewFor(sessionId).pipe(
              Effect.flatMap((view) => {
                const kept = view === null ? item : filter(view, item);
                if (item.kind !== "snapshot") return Effect.succeed(kept);
                // One line per list sent, so a child seeing too much can be traced to its cause.
                return Effect.logInfo("skycot-family.shell-filtered", {
                  sessionId,
                  child: view?.childId ?? null,
                  shared: view?.sharedSession ?? false,
                  threads: item.snapshot.threads.length,
                  projects: item.snapshot.projects.length,
                  keptThreads: kept?.kind === "snapshot" ? kept.snapshot.threads.length : null,
                  keptProjects: kept?.kind === "snapshot" ? kept.snapshot.projects.length : null,
                  ownedProjects: view === null ? null : Object.keys(view.owners.projects).length,
                }).pipe(Effect.as(kept));
              }),
            ),
          ),
          Stream.filter((item): item is OrchestrationV2ShellStreamItem => item !== null),
        );
      }),
    );

  const filterArchivedStream: SkycotFamilyVisibility["Service"]["filterArchivedStream"] = (
    sessionId,
    stream,
  ) =>
    stream.pipe(
      Stream.mapEffect((item) =>
        childViewFor(sessionId).pipe(
          Effect.map((view) => {
            if (view === null) return item;
            if (item.kind === "snapshot") {
              return {
                ...item,
                snapshot: {
                  ...item.snapshot,
                  threads: item.snapshot.threads.filter((thread) =>
                    archivedItemVisible(view, { kind: "thread.updated", thread }),
                  ),
                },
              };
            }
            return archivedItemVisible(view, item) ? item : null;
          }),
        ),
      ),
      Stream.filter((item): item is OrchestrationV2ArchivedShellStreamItem => item !== null),
    );

  return SkycotFamilyVisibility.of({
    childViewFor,
    searchableThreadIds,
    allows,
    filterShellStream,
    filterArchivedStream,
  });
});

/** For tests and tools: the fridge's pins at an explicit path. */
export const layerAt = (pinsFile: string) => Layer.effect(SkycotFamilyVisibility, makeAt(pinsFile));

/** The engine's: the fridge's pins beside the profile. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, FRIDGE_FILE_NAME));
  }),
);

/**
 * For the seam in ws.ts: the shell stream as this session may see it, or unchanged where no
 * visibility service is around (upstream's own tests).
 */
export const shellStreamFor = <E, R>(
  sessionId: string,
  stream: Stream.Stream<OrchestrationV2ShellStreamItem, E, R>,
): Stream.Stream<OrchestrationV2ShellStreamItem, E, R> =>
  Stream.unwrap(
    Effect.serviceOption(SkycotFamilyVisibility).pipe(
      Effect.map((service) =>
        Option.isSome(service) ? service.value.filterShellStream(sessionId, stream) : stream,
      ),
    ),
  );

/**
 * The shell subscription's input for this session: a child's view (own device, or the shared
 * Mac with a child chosen) always starts from a full list, never from the cursor the client
 * kept. A resumed subscription only replays changes, so a list cached under another child
 * would stay as it was; a fresh snapshot, filtered for this child, replaces it.
 */
export const shellInputFor = <I extends { readonly afterSequence?: number }>(
  sessionId: string,
  input: I,
): Effect.Effect<I> =>
  Effect.serviceOption(SkycotFamilyVisibility).pipe(
    Effect.flatMap((service) =>
      Option.isNone(service) || input.afterSequence === undefined
        ? Effect.succeed(input)
        : service.value.childViewFor(sessionId).pipe(
            Effect.map((view) => {
              if (view === null) return input;
              const { afterSequence: _cursor, ...rest } = input;
              return rest as I;
            }),
          ),
    ),
  );

/** The archived list's twin of `shellStreamFor`. */
export const archivedStreamFor = <E, R>(
  sessionId: string,
  stream: Stream.Stream<OrchestrationV2ArchivedShellStreamItem, E, R>,
): Stream.Stream<OrchestrationV2ArchivedShellStreamItem, E, R> =>
  Stream.unwrap(
    Effect.serviceOption(SkycotFamilyVisibility).pipe(
      Effect.map((service) =>
        Option.isSome(service) ? service.value.filterArchivedStream(sessionId, stream) : stream,
      ),
    ),
  );

export { referencedBy };
