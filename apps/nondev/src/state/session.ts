import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);

// `orchestration.dispatchCommand` is not in CLIENT_GUARDED_RPC_SCOPES, so the
// start-turn command carries no permissionAtom; the stock UI gates it the same
// way (apps/web/src/state/use-orchestration-command.ts). The server stays
// authoritative either way.
export const canOperateEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const result = get(environmentSession.sessionStateAtom(environmentId));
    const session = Option.getOrNull(AsyncResult.value(result));
    return (
      result._tag !== "Failure" &&
      session !== null &&
      sessionGrantsScope(session, AuthOrchestrationOperateScope)
    );
  }).pipe(Atom.withLabel(`nondev-can-operate:${environmentId}`)),
);
