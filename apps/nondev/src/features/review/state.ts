// Atoms the Review card and the Versions rail share: a turn's diff, the git
// status of the folder the thread works in, and the "commit" stacked action.
// Built here (not in src/state) because they belong to this feature alone.
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";

import { connectionAtomRuntime } from "../../connection/runtime";

export const reviewOrchestration = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
export const reviewVcs = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const reviewVcsActions = createVcsActionManager(connectionAtomRuntime);
