import {
  createEnvironmentProjectAtoms,
  createProjectEnvironmentAtoms,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentCatalog } from "./catalog";
import { environmentSnapshotAtom } from "./shell";

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
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
