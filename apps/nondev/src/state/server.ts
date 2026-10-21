import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import { createEnvironmentPresentationAtoms } from "@t3tools/client-runtime/state/presentation";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentCatalog } from "./catalog";
import { environmentSession } from "./session";

// Server config (providers, settings) per environment. Environment themes and
// usage-limit sources are the stock UI's concerns; this client reads neither.
export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
});

// Connection phase per environment, for the "Can't reach your Mac" banner.
export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});
