import { createEnvironmentProjectAtoms } from "@t3tools/client-runtime/state/projects";

import { environmentCatalog } from "./catalog";
import { environmentSnapshotAtom } from "./shell";

export const environmentProjects = createEnvironmentProjectAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});
