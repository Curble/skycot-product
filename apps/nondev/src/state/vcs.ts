// One set of Git atoms for the whole client. The review card, the Versions
// rail, the Publish flow and the composer all read the same status
// subscription per folder, so the engine streams it once, not once per feature.
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";

import { connectionAtomRuntime } from "../connection/runtime";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime);
