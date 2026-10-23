import {
  createEnvironmentProjectAtoms,
  createProjectEnvironmentAtoms,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  ProjectId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import type { FamilyView } from "../features/family/family";
import { readFamilyView, subscribeFamilyView } from "../features/family/store";
import { labelQuestionsSpaces, type QuestionsViewer } from "../features/questions/questions";
import { environmentCatalog } from "./catalog";
import { serverEnvironment } from "./server";
import { environmentSnapshotAtom } from "./shell";

let lastViewer: { readonly key: string; readonly viewer: QuestionsViewer } | null = null;

/** Who is looking, from the Family view; the same object while nothing it reads has changed. */
function viewerOf(view: FamilyView): QuestionsViewer {
  const viewer: QuestionsViewer = {
    childDevice: view.me.kind === "child",
    familyOn: view.enabled,
    children: view.children.map((child) => ({ id: child.id, name: child.name })),
  };
  const key = JSON.stringify(viewer);
  if (lastViewer?.key === key) return lastViewer.viewer;
  lastViewer = { key, viewer };
  return viewer;
}

/** The Family view as an atom, for the spaces' names (it lives in an external store). */
const questionsViewerAtom = Atom.make((get): QuestionsViewer => {
  get.addFinalizer(subscribeFamilyView(() => get.setSelf(viewerOf(readFamilyView()))));
  return viewerOf(readFamilyView());
}).pipe(Atom.withLabel("nondev-questions-viewer"));

// One relabelled copy per engine project object and viewer, so a project's atom only changes
// when the engine's project (or who is looking) does; the snapshot changes on every update.
const relabelled = new WeakMap<
  QuestionsViewer,
  WeakMap<OrchestrationProjectShell, OrchestrationProjectShell>
>();

/**
 * The engine's Questions spaces get SKYCOT's names (T3 titles its Scratch project "No
 * project"): "Questions", "Ava's questions", "Earlier questions" (`labelQuestionsSpaces`).
 * Renamed here, once, so every screen that shows a project's name says the same thing.
 */
const questionsAwareSnapshotAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): OrchestrationV2ShellSnapshot | null => {
    const snapshot = get(environmentSnapshotAtom(environmentId));
    const root = get(serverEnvironment.configValueAtom(environmentId))?.scratchWorkspaceRoot;
    if (snapshot === null || !root) return snapshot;
    const viewer = get(questionsViewerAtom);
    const named = labelQuestionsSpaces(snapshot.projects, root, viewer);
    if (named === null) return snapshot;
    let copies = relabelled.get(viewer);
    if (copies === undefined) {
      copies = new WeakMap();
      relabelled.set(viewer, copies);
    }
    return {
      ...snapshot,
      projects: snapshot.projects.map((project, index) => {
        const next = named[index]!;
        if (next === project) return project;
        const kept = copies.get(project);
        if (kept !== undefined) return kept;
        copies.set(project, next);
        return next;
      }),
    };
  }).pipe(Atom.withLabel(`nondev-questions-snapshot:${environmentId}`)),
);

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: questionsAwareSnapshotAtom,
  // Marks T3's Scratch project (`isScratch`); a child's own space is marked above.
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("nondev-project:empty"),
);

// `projectAtom` validates its key, so callers that may not have a project yet
// read this instead of passing placeholder ids.
export function projectAtomOrEmpty(ref: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null | undefined;
}) {
  return ref.environmentId !== null && ref.projectId != null
    ? environmentProjects.projectAtom({
        environmentId: ref.environmentId,
        projectId: ref.projectId,
      })
    : EMPTY_PROJECT_ATOM;
}

// Mutations: `create` is what "Open a folder…" dispatches.
export const projectEnvironment = createProjectEnvironmentAtoms(connectionAtomRuntime, {
  projectAtom: environmentProjects.projectAtom,
});
