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
import { familyOn } from "../features/family/family";
import { readFamilyView } from "../features/family/store";
import { isQuestionsProject, projectForConversation } from "../features/questions/questions";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

export interface ConversationRow {
  readonly shell: EnvironmentThreadShell;
  /** The project it belongs with: a question that became a project is listed with that one. */
  readonly project: EnvironmentProject | null;
  /** `projectKeyOf` of `project` (the sidebar's counts and filter use it). */
  readonly projectKey: string;
  readonly title: string;
  readonly status: ConversationStatus;
  readonly preview: string;
  /** ISO time the row sorts and groups by. */
  readonly at: string;
}

const REFUSED_KEY = "skycot:refused-runs";
/** Newest last; old runs fall off so the list never grows without bound. */
const REFUSED_LIMIT = 200;

function readRefusedRunIds(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(REFUSED_KEY);
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

/** The next set with `runId` in it, remembered across reloads when storage allows. */
export function withRefusedRun(current: ReadonlySet<string>, runId: string): ReadonlySet<string> {
  const next = [...current, runId].slice(-REFUSED_LIMIT);
  try {
    window.localStorage.setItem(REFUSED_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: this session still knows.
  }
  return new Set(next);
}

/**
 * Runs the conversation view has seen end on a refusal. The shell cannot see
 * decisions, so the list learns them here once a thread was opened (and
 * remembers them across reloads); until then it reads the Crew's closing words
 * (status.ts `saysRefused`).
 */
export const refusedRunIdsAtom = Atom.make<ReadonlySet<string>>(readRefusedRunIds()).pipe(
  Atom.keepAlive,
  Atom.withLabel("nondev-refused-run-ids"),
);

function noPlanFlags(): ReadonlySet<string> {
  return new Set<string>();
}

/**
 * Conversations whose engine "a plan is active" flag the conversation view found stale, keyed by
 * the run it was found at (a later plan always comes with a later run, so it is read afresh).
 * The shell cannot see plans being built, replaced or taken back, so the list learns it here
 * once a thread was opened and until then shows the engine's flag. Kept for this session only.
 */
export const planNotWaitingAtom = Atom.make<ReadonlySet<string>>(noPlanFlags()).pipe(
  Atom.keepAlive,
  Atom.withLabel("nondev-plan-not-waiting"),
);

export function planFlagKey(shell: Pick<EnvironmentThreadShell, "id" | "latestRun">): string {
  return `${String(shell.id)}:${shell.latestRun?.runId ?? ""}`;
}

/** The shell with its plan flag cleared when the view found no plan really waiting at this run. */
export function withRealPlanFlag(
  shell: EnvironmentThreadShell,
  notWaiting: ReadonlySet<string>,
): EnvironmentThreadShell {
  return shell.hasActionableProposedPlan && notWaiting.has(planFlagKey(shell))
    ? { ...shell, hasActionableProposedPlan: false }
    : shell;
}

/** One list row from a thread shell: its project, plain title, status and preview. */
export function toConversationRow(
  get: Atom.AtomContext,
  shell: EnvironmentThreadShell,
  refusedRuns: ReadonlySet<string>,
  planNotWaiting: ReadonlySet<string> = new Set(),
): ConversationRow {
  const runId = shell.latestRun?.runId ?? null;
  const family = readFamilyView();
  const real = withRealPlanFlag(shell, planNotWaiting);
  const status = describeThreadStatus(real, {
    refused: runId !== null && refusedRuns.has(runId),
    childView: familyOn(family) && family.me.kind !== "grown-up",
  });
  const own = get(
    environmentProjects.projectAtom({
      environmentId: shell.environmentId,
      projectId: shell.projectId,
    }),
  );
  // Only a question can move, so the full project list is read for questions alone.
  const project = isQuestionsProject(own)
    ? projectForConversation(shell, own, get(environmentProjects.projectsAtom))
    : own;
  return {
    shell: real,
    project,
    projectKey:
      project === null
        ? projectKeyOf(shell)
        : projectKeyOf({ environmentId: project.environmentId, projectId: project.id }),
    title: conversationTitle(shell),
    status,
    preview: conversationPreview(real, status),
    at: shell.updatedAt,
  };
}

export function newestFirst(rows: ConversationRow[]): ConversationRow[] {
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// Every open, top-level conversation across the enabled environments, newest
// first, with its plain status. Reads the shell list only (no per-thread
// subscription), which is what keeps the list cheap however many threads exist.
export const conversationRowsAtom = Atom.make((get): ReadonlyArray<ConversationRow> => {
  const shells = get(environmentThreadShells.navigationThreadShellsAtom);
  const refusedRuns = get(refusedRunIdsAtom);
  const planNotWaiting = get(planNotWaitingAtom);
  return newestFirst(
    shells.map((shell) => toConversationRow(get, shell, refusedRuns, planNotWaiting)),
  );
}).pipe(Atom.withLabel("nondev-conversation-rows"));

/** "old" lists the conversations that were put away (archived). */
export type ConversationFilter = "all" | "waiting" | "ready" | "old";

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
    if (projectKey !== null && row.projectKey !== projectKey) return false;
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
