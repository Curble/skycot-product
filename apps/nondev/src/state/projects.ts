import {
  createEnvironmentProjectAtoms,
  createProjectEnvironmentAtoms,
  isScratchProject,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  ProjectId,
} from "@t3tools/contracts";
import { QUESTIONS_LABEL } from "@t3tools/skycot-rules/questions";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentCatalog } from "./catalog";
import { serverEnvironment } from "./server";
import { environmentSnapshotAtom } from "./shell";

// One relabelled copy per engine project object, so a project's atom only changes when the
// engine's project does (the snapshot itself changes on every thread update).
const relabelled = new WeakMap<OrchestrationProjectShell, OrchestrationProjectShell>();

/**
 * The engine's Scratch project is SKYCOT's "Questions" (T3 titles it "No project"). Renamed
 * here, once, so every screen that shows a project's name says the same thing.
 */
const questionsAwareSnapshotAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): OrchestrationV2ShellSnapshot | null => {
    const snapshot = get(environmentSnapshotAtom(environmentId));
    const root = get(serverEnvironment.configValueAtom(environmentId))?.scratchWorkspaceRoot;
    if (snapshot === null || !root) return snapshot;
    if (!snapshot.projects.some((project) => isScratchProject(project, root))) return snapshot;
    return {
      ...snapshot,
      projects: snapshot.projects.map((project) => {
        if (!isScratchProject(project, root)) return project;
        let copy = relabelled.get(project);
        if (copy === undefined) {
          copy = { ...project, title: QUESTIONS_LABEL };
          relabelled.set(project, copy);
        }
        return copy;
      }),
    };
  }).pipe(Atom.withLabel(`nondev-questions-snapshot:${environmentId}`)),
);

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: questionsAwareSnapshotAtom,
  // Marks the Questions space (`isScratch`), which the compose box and the list read.
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
