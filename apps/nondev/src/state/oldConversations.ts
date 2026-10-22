// Conversations that were put away (archived). The engine keeps them out of the live shell
// stream and serves them from a separate, bounded query; this re-reads that query whenever
// an environment's live list gains or loses a conversation (something was put away or brought
// back, here or on another device), and on demand after a rename here.
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ORCHESTRATION_V2_WS_METHODS, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

import { connectionAtomRuntime } from "../connection/runtime";
import { enabledEnvironmentIdsAtom } from "./catalog";
import {
  newestFirst,
  refusedRunIdsAtom,
  toConversationRow,
  type ConversationRow,
} from "./conversations";
import { environmentThreadShells } from "./threads";

const archivedSnapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "nondev:old-conversations",
  tag: ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  refreshTrigger: ({ environmentId }) =>
    environmentThreadShells.environmentThreadRefsAtom(environmentId),
});

const snapshotAtom = (environmentId: EnvironmentId) =>
  archivedSnapshot({ environmentId, input: {} });

/** Every put-away, top-level conversation across the enabled environments, newest first. */
export const oldConversationRowsAtom = Atom.make((get): ReadonlyArray<ConversationRow> => {
  const refusedRuns = get(refusedRunIdsAtom);
  const rows: ConversationRow[] = [];
  for (const environmentId of get(enabledEnvironmentIdsAtom)) {
    const snapshot = Option.getOrNull(AsyncResult.value(get(snapshotAtom(environmentId))));
    for (const thread of snapshot?.threads ?? []) {
      if (thread.lineage.relationshipToParent === "subagent" || thread.deletedAt !== null) {
        continue;
      }
      rows.push(toConversationRow(get, presentThreadShell(environmentId, thread), refusedRuns));
    }
  }
  return newestFirst(rows);
}).pipe(Atom.withLabel("nondev-old-conversation-rows"));

/** True until every environment's first answer has arrived. */
export const oldConversationsLoadingAtom = Atom.make((get): boolean =>
  get(enabledEnvironmentIdsAtom).some((environmentId) => {
    const result = get(snapshotAtom(environmentId));
    return result.waiting && Option.isNone(AsyncResult.value(result));
  }),
).pipe(Atom.withLabel("nondev-old-conversations-loading"));

/** The put-away conversation's shell, or null when it is live (or unknown). */
export function findOldShell(
  rows: ReadonlyArray<ConversationRow>,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): EnvironmentThreadShell | null {
  return (
    rows.find((row) => row.shell.environmentId === environmentId && row.shell.id === threadId)
      ?.shell ?? null
  );
}

/** A rename of a put-away conversation reaches only the archive's own query: ask again. */
export function refreshOldConversations(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(snapshotAtom(environmentId));
}

const NO_ROWS_ATOM = Atom.make<ReadonlyArray<ConversationRow>>([]).pipe(
  Atom.withLabel("nondev-old-rows:none"),
);

/**
 * A conversation's shell whether it is live or put away. Live conversations never touch the
 * archive's query; one that is not in the live list is looked for there.
 */
export function useConversationShell(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): { readonly shell: EnvironmentThreadShell | null; readonly archived: boolean } {
  const live = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId }));
  const oldRows = useAtomValue(live === null ? oldConversationRowsAtom : NO_ROWS_ATOM);
  if (live !== null) return { shell: live, archived: false };
  const old = findOldShell(oldRows, environmentId, threadId);
  return { shell: old, archived: old !== null };
}
