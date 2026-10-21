import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime/state/filesystem";

import { connectionAtomRuntime } from "../connection/runtime";

// `browse({ environmentId, input: { partialPath } })` lists a host directory for
// the Open-folder sheet.
export const filesystemEnvironment = createFilesystemEnvironmentAtoms(connectionAtomRuntime);
