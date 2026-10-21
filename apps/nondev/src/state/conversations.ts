import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { Atom } from "effect/reactivity";

import {
  conversationPreview,
  conversationTitle,
  describeThreadStatus,
  type ConversationStatus,
} from "../features/conversation/status";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

export interface ConversationRow {
  readonly shell: EnvironmentThreadShell;
  readonly project: EnvironmentProject | null;
  readonly title: string;
  readonly status: ConversationStatus;
  readonly preview: string;
  /** ISO time the row sorts and groups by. */
  readonly at: string;
}

/**
 * Runs the conversation view has seen end on a refusal. The shell cannot see
 * decisions, so the list learns them here once a thread was opened; until then
 * it reads the Crew's closing words (status.ts `saysRefused`).
 */
export const refusedRunIdsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
  Atom.withLabel("nondev-refused-run-ids"),
);

// Every open, top-level conversation across the enabled environments, newest
// first, with its plain status. Reads the shell list only (no per-thread
// subscription), which is what keeps the list cheap however many threads exist.
export const conversationRowsAtom = Atom.make((get): ReadonlyArray<ConversationRow> => {
  const shells = get(environmentThreadShells.navigationThreadShellsAtom);
  const refusedRuns = get(refusedRunIdsAtom);
  const rows = shells.map((shell): ConversationRow => {
    const runId = shell.latestRun?.runId ?? null;
    const status = describeThreadStatus(shell, {
      refused: runId !== null && refusedRuns.has(runId),
    });
    return {
      shell,
      project: get(
        environmentProjects.projectAtom({
          environmentId: shell.environmentId,
          projectId: shell.projectId,
        }),
      ),
      title: conversationTitle(shell),
      status,
      preview: conversationPreview(shell, status),
      at: shell.updatedAt,
    };
  });
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rows;
}).pipe(Atom.withLabel("nondev-conversation-rows"));

export type ConversationFilter = "all" | "waiting" | "ready";

export function filterRows(
  rows: ReadonlyArray<ConversationRow>,
  filter: ConversationFilter,
  projectKey: string | null,
  search: string,
): ReadonlyArray<ConversationRow> {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "waiting" && row.status.attention !== "waiting") return false;
    if (filter === "ready" && row.status.kind !== "ready") return false;
    if (projectKey !== null && projectKeyOf(row.shell) !== projectKey) return false;
    if (needle.length > 0) {
      const haystack = `${row.title} ${row.preview} ${row.project?.title ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function projectKeyOf(ref: { readonly environmentId: string; readonly projectId: string }) {
  return `${ref.environmentId}:${ref.projectId}`;
}
