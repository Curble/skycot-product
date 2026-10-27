// nondev-seam: skycot-iphone-q39-conversation-labels
// nondev-seam: skycot-iphone-q50-place-name
/**
 * Every conversation this device may see, from every linked Mac, in one list. Each row says
 * which Mac it lives on: conversations are never copied between Macs, they are shown side by
 * side (the plan's "Several Macs" decision). On a child's device the engine has already left
 * out everyone else's work; this only sorts and labels.
 */
import {
  isQuestionsSpace,
  questionsSpaceLabel,
  questionsSpaceOf,
} from "@t3tools/skycot-rules/questions";

import type { ProjectShell, ShellSnapshot, ThreadShell } from "../engine/types";
import type { Mac } from "../links/store";
import type { MacState } from "./MacData";

export interface ConversationRow {
  readonly key: string;
  readonly mac: Mac;
  readonly thread: ThreadShell;
  readonly project: ProjectShell | null;
  readonly projectTitle: string;
  readonly updatedAt: number;
  readonly state: "working" | "waiting" | "done" | "idle" | "failed";
}

const LIVE = new Set(["preparing", "starting", "running"]);

export function threadState(thread: ThreadShell): ConversationRow["state"] {
  if (thread.pendingRuntimeRequest !== null) return "waiting";
  if (thread.status === "waiting") return "waiting";
  if (LIVE.has(thread.status)) return "working";
  if (thread.status === "failed" || thread.status === "interrupted") return "failed";
  if (thread.status === "completed") return "done";
  return "idle";
}

export function stateLabel(state: ConversationRow["state"], builder: string): string | null {
  switch (state) {
    case "working":
      return `${builder} is working`;
    case "waiting":
      return "Waiting for you";
    case "failed":
      return "Something went wrong";
    case "done":
      return "Done";
    default:
      return null;
  }
}

export function childStatusLabel(
  state: ConversationRow["state"],
  builder: string,
  hasPage: boolean,
): string | null {
  if (state === "working") return `${builder} is working`;
  if (state === "waiting") return "Waiting for a grown-up";
  if (state === "done" && hasPage) return "Ready to play";
  return stateLabel(state, builder);
}

/** One of the Mac's Questions spaces (Just ask): the shared one, or a child's own. */
export function isQuestionsProject(project: ProjectShell | null, questionsRoot: string | null) {
  return project !== null && isQuestionsSpace(project.workspaceRoot, questionsRoot);
}

/**
 * What a conversation's project is called on this device. A Questions space: "Questions" on a
 * child's own device (the Mac sends it only theirs), "Earlier questions" for the shared space
 * the questions from before stay in; a grown-up's phone, which doesn't read where the Mac keeps
 * them, shows the Mac's own title ("Ava's questions").
 */
export function projectTitleFor(
  project: ProjectShell | null,
  mac: Pick<Mac, "me" | "macName">,
  questionsRoot: string | null,
): string {
  const space = project === null ? null : questionsSpaceOf(project.workspaceRoot, questionsRoot);
  if (space === null)
    return mac.me.kind === "child"
      ? childPlaceName(project?.title, mac.macName)
      : (project?.title ?? "A project");
  const label = questionsSpaceLabel(space, {
    childDevice: mac.me.kind === "child",
    // A linked device exists only while the Family profile is on.
    familyOn: true,
    nameOf: () => null,
    title: project?.title,
  });
  return label === "Questions" && mac.me.kind === "child" ? childPlaceName(null) : label;
}

/** Folder and computer labels are for grown-ups; children see names made for their projects. */
export function childPlaceName(title: string | null | undefined, computerName?: string): string {
  const clean = title?.trim();
  if (
    !clean ||
    clean === computerName ||
    /^(?:[a-z0-9]+[-_])*(?:device|mac|computer)(?:[-_][a-z0-9]+)*$/iu.test(clean)
  )
    return "My project";
  return clean;
}

export const childProjectTitle = childPlaceName;

export function conversationRows(
  macs: ReadonlyArray<Mac>,
  byMac: Readonly<Record<string, MacState>>,
  questionsRoots: Readonly<Record<string, string | null>> = {},
): Array<ConversationRow> {
  const rows: Array<ConversationRow> = [];
  for (const mac of macs) {
    const shell: ShellSnapshot | null = byMac[mac.macId]?.shell ?? null;
    if (shell === null) continue;
    for (const thread of shell.threads) {
      if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
      const project = shell.projects.find((candidate) => candidate.id === thread.projectId) ?? null;
      rows.push({
        key: `${mac.macId}:${thread.id}`,
        mac,
        thread,
        project,
        projectTitle: projectTitleFor(project, mac, questionsRoots[mac.macId] ?? null),
        updatedAt: Date.parse(String(thread.updatedAt)) || 0,
        state: threadState(thread),
      });
    }
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A child's list names the project, never the computer that stores it. */
export function rowLabel(row: ConversationRow): string {
  return row.projectTitle;
}

export function relativeTime(at: number, now: number = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
