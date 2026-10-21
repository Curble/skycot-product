import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);

export const enabledEnvironmentIdsAtom = Atom.make((get) => [
  ...enabledEnvironmentIds(get(environmentCatalog.catalogValueAtom)),
]).pipe(Atom.withLabel("nondev-enabled-environment-ids"));
