// Plain-language status for a conversation row and header, derived from the
// shell (list) projection only, so the list never subscribes to full threads.
// Every sentence comes from plain/copy.ts `progress`; this file only decides
// which one applies. Belongs in apps/nondev/src/plain/ once that layer grows a
// shell mapper.
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { progress } from "../../plain/copy";
import type { PillTone } from "../../ui/Pill";

/** "Stopped." reads as a sentence; a list row wants the label "Stopped". */
function label(sentence: string): string {
  return sentence.replace(/[.…]+$/, "");
}

export type ConversationStatusKind =
  | "waiting"
  | "preparing"
  | "working"
  | "ready"
  | "done"
  | "failed"
  | "stopped"
  | "new";

export interface ConversationStatus {
  readonly kind: ConversationStatusKind;
  /** One line for the row: "Waiting for you · needs your OK". */
  readonly headline: string;
  /** Short presence line for the header: "Working in a private copy". */
  readonly presence: string;
  readonly tone: PillTone;
  /** Dot in the list: orange for waiting, blue for done-and-unseen. */
  readonly attention: "none" | "waiting" | "ready";
}

export function describeThreadStatus(shell: EnvironmentThreadShell): ConversationStatus {
  if (shell.hasPendingApprovals) {
    return {
      kind: "waiting",
      headline: "Waiting for you · needs your OK before it carries on",
      presence: "Waiting for you · nothing runs until you answer",
      tone: "waiting",
      attention: "waiting",
    };
  }
  if (shell.hasPendingUserInput) {
    return {
      kind: "waiting",
      headline: "Waiting for you · has a question",
      presence: "Waiting for you · it has a question",
      tone: "waiting",
      attention: "waiting",
    };
  }
  if (shell.hasActionableProposedPlan) {
    return {
      kind: "waiting",
      headline: "Waiting for you · the plan is ready to approve",
      presence: "Waiting for you · plan ready",
      tone: "waiting",
      attention: "waiting",
    };
  }
  const runtime = shell.runtime?.status ?? "idle";
  switch (runtime) {
    case "preparing":
    case "queued":
    case "starting":
      return {
        kind: "preparing",
        headline: progress.gettingReady,
        presence: label(progress.gettingReady),
        tone: "working",
        attention: "none",
      };
    case "running":
      return {
        kind: "working",
        headline: progress.working,
        presence: "Working · your files are only changed inside this project",
        tone: "working",
        attention: "none",
      };
    case "waiting":
      return {
        kind: "working",
        headline: "Finishing up…",
        presence: "Finishing up",
        tone: "working",
        attention: "none",
      };
    default:
      break;
  }
  const run = shell.latestRun;
  if (run === null) {
    return {
      kind: "new",
      headline: label(progress.nothingYet),
      presence: "Ready when you are",
      tone: "neutral",
      attention: "none",
    };
  }
  switch (run.status) {
    case "failed":
      return {
        kind: "failed",
        headline: label(progress.somethingWentWrong),
        presence: "Stopped · something went wrong",
        tone: "danger",
        attention: "ready",
      };
    case "interrupted":
    case "cancelled":
      return {
        kind: "stopped",
        headline: label(progress.stopped),
        presence: `${label(progress.stopped)} · ready when you are`,
        tone: "neutral",
        attention: "none",
      };
    case "rolled_back":
      return {
        kind: "done",
        headline: label(progress.restored),
        presence: "Restored · ready when you are",
        tone: "neutral",
        attention: "none",
      };
    default: {
      const unseen = isUnseenSince(shell.lastVisitedAt, run.completedAt);
      return unseen
        ? {
            kind: "ready",
            headline: "Done — ready to look at",
            presence: "Done · ready to look at",
            tone: "ok",
            attention: "ready",
          }
        : {
            kind: "done",
            headline: label(progress.allDone),
            presence: "Ready when you are",
            tone: "ok",
            attention: "none",
          };
    }
  }
}

function isUnseenSince(lastVisitedAt: string | null | undefined, completedAt: string | null) {
  if (completedAt === null) return false;
  if (lastVisitedAt === null || lastVisitedAt === undefined) return true;
  return Date.parse(lastVisitedAt) < Date.parse(completedAt);
}

/** "Crew: Done — GST is on the invoice total." / "You: add a vegan option" */
export function conversationPreview(shell: EnvironmentThreadShell, status: ConversationStatus) {
  const latest = shell.source.latestVisibleMessage;
  if (status.kind === "waiting" || status.kind === "working" || status.kind === "preparing") {
    return `Crew: ${status.headline}`;
  }
  if (latest !== null && latest.text.trim().length > 0) {
    const who = latest.role === "user" ? "You" : "Crew";
    return `${who}: ${firstLine(latest.text)}`;
  }
  return `Crew: ${status.headline}`;
}

export function conversationTitle(shell: EnvironmentThreadShell): string {
  const title = shell.title.trim();
  if (title.length > 0) return title;
  const latest = shell.source.latestVisibleMessage;
  if (latest && latest.role === "user") return firstLine(latest.text, 80);
  return "New conversation";
}

function firstLine(text: string, max = 160): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "";
  const clean = line.replace(/^#+\s*/, "").replace(/[*_`]/g, "");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Messages-style timestamp: time today, weekday this week, else a short date. */
export function formatRowTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const diffDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function dateGroup(iso: string, now = new Date()): DateGroup {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  if ((now.getTime() - date.getTime()) / 86_400_000 < 7) return "This week";
  return "Earlier";
}

/** "Today 8:32 am" for the day divider at the top of a stream. */
export function formatDayDivider(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const group = dateGroup(iso, now);
  if (group === "Today" || group === "Yesterday") return `${group} ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} ${time}`;
}
