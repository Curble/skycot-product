import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { enabledEnvironmentIdsAtom, environmentCatalog } from "../state/catalog";
import { environmentPresentations } from "../state/server";

export type ConnectionPhase = EnvironmentConnectionPhase | "waiting";

const EMPTY_PRESENTATION_ATOM = Atom.make<null>(null).pipe(
  Atom.withLabel("nondev-presentation:empty"),
);

/**
 * The primary environment's connection phase, or "waiting" while the engine
 * has not registered yet. Screens read it so an empty list, a greeting or a
 * disabled Send can say "waiting for your Mac" instead of "nothing here".
 */
export function useConnectionPhase(): ConnectionPhase {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId: EnvironmentId | null = environmentIds[0] ?? null;
  const presentation = useAtomValue(
    environmentId === null
      ? EMPTY_PRESENTATION_ATOM
      : environmentPresentations.presentationAtom(environmentId),
  );
  if (!catalog.isReady || environmentId === null) return "waiting";
  return presentation?.connection.phase ?? "connecting";
}

export function useConnected(): boolean {
  return useConnectionPhase() === "connected";
}
