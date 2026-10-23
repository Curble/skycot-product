/**
 * Every conversation this device may see, from every linked Mac, in one list. Each row says
 * which Mac it lives on: conversations are never copied between Macs, they are shown side by
 * side (the plan's "Several Macs" decision). On a child's device the engine has already left
 * out everyone else's work; this only sorts and labels.
 */
import { QUESTIONS_LABEL } from "@t3tools/skycot-rules/questions";

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
      return `${builder} is building…`;
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

export function isQuestionsProject(project: ProjectShell | null, questionsRoot: string | null) {
  return project !== null && questionsRoot !== null && project.workspaceRoot === questionsRoot;
}

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
      const question = isQuestionsProject(project, questionsRoots[mac.macId] ?? null);
      rows.push({
        key: `${mac.macId}:${thread.id}`,
        mac,
        thread,
        project,
        projectTitle: question ? QUESTIONS_LABEL : (project?.title ?? "A project"),
        updatedAt: Date.parse(String(thread.updatedAt)) || 0,
        state: threadState(thread),
      });
    }
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** "MamaBear · Space game" when there are several Macs, else just the project. */
export function rowLabel(row: ConversationRow, severalMacs: boolean): string {
  return severalMacs ? `${row.mac.macName} · ${row.projectTitle}` : row.projectTitle;
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
