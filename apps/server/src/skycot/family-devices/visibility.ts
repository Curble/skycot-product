// Per-person visibility, pure part: what a child's own device may see of the family's work
// (decision 5 of the iPhone plan). The rules themselves are in @t3tools/skycot-rules/people
// (`childSeesThread`, `childSeesProject`); this file applies them to the engine's shapes: the
// shell snapshot and its live items, the archived list, and the ids a call names.
//
// Grown-ups' devices and the family's Mac see everything; only a child's own device is filtered.
import type {
  OrchestrationProjectShell,
  OrchestrationV2ArchivedShellSnapshot,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";

import { childSeesProject, childSeesThread, type Owners } from "@t3tools/skycot-rules/people";

/** What a child's own device is judged by: the child, who owns what, and the fridge's pins. */
export interface ChildView {
  readonly childId: string;
  readonly owners: Owners;
  /** Conversations pinned to the fridge: their pages stay readable on every child's device. */
  readonly pinned: ReadonlySet<string>;
  /** The family's Mac uses the selected child without the linked-device legacy filters. */
  readonly sharedSession?: boolean;
}

type ThreadLike = Pick<OrchestrationV2ThreadShell, "id" | "projectId">;

/** The projects the child's own conversations live in (a sibling's project then stays listed for them). */
export function ownThreadProjects(
  view: ChildView,
  threads: ReadonlyArray<ThreadLike>,
): Set<string> {
  return new Set(
    threads
      .filter((thread) => childSeesThread(view.childId, thread.id, view.owners))
      .map((thread) => thread.projectId),
  );
}

function filterThreadsAndProjects<
  T extends ThreadLike,
  P extends Pick<OrchestrationProjectShell, "id">,
>(
  view: ChildView,
  threads: ReadonlyArray<T>,
  projects: ReadonlyArray<P>,
  extraThreads: ReadonlyArray<ThreadLike> = [],
) {
  const visibleThreads = threads.filter((thread) =>
    childSeesThread(view.childId, thread.id, view.owners),
  );
  const withOwn = ownThreadProjects(view, [...threads, ...extraThreads]);
  const visibleProjects = projects.filter((project) =>
    childSeesProject(view.childId, project.id, view.owners, withOwn),
  );
  return { visibleThreads, visibleProjects, withOwn };
}

export function filterShellSnapshot(
  view: ChildView,
  snapshot: OrchestrationV2ShellSnapshot,
): OrchestrationV2ShellSnapshot {
  const { visibleThreads, visibleProjects } = filterThreadsAndProjects(
    view,
    snapshot.threads,
    snapshot.projects,
    snapshot.archivedThreads,
  );
  return {
    ...snapshot,
    threads: visibleThreads,
    archivedThreads: snapshot.archivedThreads.filter((thread) =>
      childSeesThread(view.childId, thread.id, view.owners),
    ),
    projects: visibleProjects,
  };
}

export function filterArchivedSnapshot(
  view: ChildView,
  snapshot: OrchestrationV2ArchivedShellSnapshot,
): OrchestrationV2ArchivedShellSnapshot {
  const { visibleThreads, visibleProjects } = filterThreadsAndProjects(
    view,
    snapshot.threads,
    snapshot.projects,
  );
  return { ...snapshot, threads: visibleThreads, projects: visibleProjects };
}

/**
 * A live shell subscription's filter. It remembers the projects the child's own conversations
 * are in (learned from the snapshot and from each update), so such a project stays listed even
 * when a sibling started it. Removals always pass: a removal of something never shown is a
 * no-op for the client, and holding one back could leave a stale row.
 */
export function makeShellItemFilter() {
  const projectsWithOwn = new Set<string>();
  return (
    view: ChildView,
    item: OrchestrationV2ShellStreamItem,
  ): OrchestrationV2ShellStreamItem | null => {
    switch (item.kind) {
      case "synchronized":
      case "project.removed":
      case "thread.removed":
        return item;
      case "snapshot": {
        for (const projectId of ownThreadProjects(view, [
          ...item.snapshot.threads,
          ...item.snapshot.archivedThreads,
        ])) {
          projectsWithOwn.add(projectId);
        }
        return { ...item, snapshot: filterShellSnapshot(view, item.snapshot) };
      }
      case "thread.updated": {
        if (!childSeesThread(view.childId, item.thread.id, view.owners)) return null;
        projectsWithOwn.add(item.thread.projectId);
        return item;
      }
      case "project.updated":
        return childSeesProject(view.childId, item.project.id, view.owners, projectsWithOwn)
          ? item
          : null;
    }
  };
}

/** The same for the archived list's live items. */
export function archivedItemVisible(
  view: ChildView,
  item: { readonly kind: string; readonly thread?: ThreadLike },
): boolean {
  if (item.kind !== "thread.updated" || item.thread === undefined) return true;
  return childSeesThread(view.childId, item.thread.id, view.owners);
}

/** The conversations, projects and folders a call names, wherever in its payload they sit. */
export interface Referenced {
  readonly threadIds: ReadonlyArray<string>;
  readonly projectIds: ReadonlyArray<string>;
  readonly folders: ReadonlyArray<string>;
}

const THREAD_KEYS = ["threadId", "targetThreadId", "sourceThreadId", "parentThreadId"] as const;
const FOLDER_KEYS = ["cwd", "worktreePath", "workspaceRoot"] as const;
/** Nested objects a call may carry ids in (asset resources, Build it's plan, a launch's folder). */
const NESTED_KEYS = ["resource", "sourcePlanRef", "workspaceStrategy", "initialMessage"] as const;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function referencedBy(payload: unknown): Referenced {
  const threadIds = new Set<string>();
  const projectIds = new Set<string>();
  const folders = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    const input = record(value);
    for (const key of THREAD_KEYS) {
      if (typeof input[key] === "string") threadIds.add(input[key]);
    }
    if (typeof input["projectId"] === "string") projectIds.add(input["projectId"]);
    for (const key of FOLDER_KEYS) {
      if (typeof input[key] === "string") folders.add(input[key]);
    }
    if (depth > 0) for (const key of NESTED_KEYS) visit(input[key], depth - 1);
  };
  visit(payload, 2);
  return { threadIds: [...threadIds], projectIds: [...projectIds], folders: [...folders] };
}

/** Paths compared the way the engine stores them: no trailing slash. */
const trimmed = (folder: string) => folder.replace(/[/\\]+$/, "");

/**
 * The most specific known folder a path is inside: a conversation's private copy beats the
 * project folder it was copied from. Null when the path is in none of them (then the Family
 * gate's other rules decide, as before).
 */
export function folderOwner(
  folder: string,
  known: {
    readonly threads: ReadonlyArray<{ readonly threadId: string; readonly worktreePath: string }>;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly workspaceRoot: string;
    }>;
  },
  separator = "/",
):
  | { readonly type: "thread"; readonly id: string }
  | { readonly type: "project"; readonly id: string }
  | null {
  const target = trimmed(folder);
  const inside = (root: string) => {
    const base = trimmed(root);
    return base.length > 0 && (target === base || target.startsWith(`${base}${separator}`));
  };
  let best: { type: "thread" | "project"; id: string; length: number } | null = null;
  for (const entry of known.threads) {
    const length = trimmed(entry.worktreePath).length;
    if (inside(entry.worktreePath) && (best === null || length > best.length)) {
      best = { type: "thread", id: entry.threadId, length };
    }
  }
  // A project folder wins a tie with a conversation that works straight in it (no private copy):
  // the folder is the project's, shared by whoever may see the project.
  for (const entry of known.projects) {
    const length = trimmed(entry.workspaceRoot).length;
    if (inside(entry.workspaceRoot) && (best === null || length >= best.length)) {
      best = { type: "project", id: entry.projectId, length };
    }
  }
  return best === null ? null : { type: best.type, id: best.id };
}
