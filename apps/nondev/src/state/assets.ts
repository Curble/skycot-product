import { createAssetEnvironmentAtoms } from "@t3tools/client-runtime/state/assets";

import { connectionAtomRuntime } from "../connection/runtime";

/** Short-lived signed addresses for files the engine holds, such as a sent picture. */
export const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);
