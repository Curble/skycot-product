// Plain-language status for a conversation row and header, derived from the
// shell (list) projection only, so the list never subscribes to full threads.
// Every sentence comes from plain/copy.ts `progress`; this file only decides
// which one applies. Belongs in apps/nondev/src/plain/ once that layer grows a
// shell mapper.
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { CREW_NAME } from "../../brand";
import { promptTitle } from "../../plain/titles";
import { progress } from "../../plain/copy";
import type { PillTone } from "../../ui/Pill";

/** "Stopped." reads as a sentence; a list row wants the label "Stopped". */
function label(sentence: string): string {
  return sentence.replace(/[.…]+$/, "");
}

export type ConversationStatusKind =
  | "plan"
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
  /** The run ended by asking something in a plain message, so a reply is the next step. */
  readonly needsReply?: true;
  /** The run ended because the person said no to a step and nothing changed. */
  readonly refused?: true;
}

/** A finished build uses its checkpoint action as the one status pill. */
export function hasReadyCheckpointPill(
  status: ConversationStatus,
  latestId: string | null,
  active: boolean,
): boolean {
  return latestId !== null && status.kind === "ready" && !active;
}

export interface ThreadStatusOptions {
  /**
   * Set when the full projection shows the latest run ended on a refusal (the
   * conversation view knows; the list learns it once the thread was opened).
   */
  readonly refused?: boolean;
  /** Child wording is selected by the view, keeping grown-up devices unchanged. */
  readonly childView?: boolean;
}

/** The Crew's own words for "you said no": providers close a refused run with a statement. */
const SAYS_REFUSED =
  /\b(approval|permission|request|command|step)s?\b[^.!?\n]{0,40}\b(was|were|got|has been|have been)\s+(rejected|declined|denied|refused|not (granted|approved|allowed))\b|\byou (declined|rejected|denied|refused|said no|did ?n[o']t (approve|allow))\b|\b(declined|rejected|denied|refused) (the|my|this|that) (request|approval|command|permission|step)\b/i;

/** True when the Crew's closing message says a step was refused. */
export function saysRefused(text: string): boolean {
  return SAYS_REFUSED.test(text.replace(/```[\s\S]*?```/g, " "));
}

export const REFUSED_STATUS: Pick<
  ConversationStatus,
  "kind" | "headline" | "presence" | "tone" | "attention" | "refused"
> = {
  kind: "stopped",
  headline: "Stopped — you said no",
  presence: "Stopped · you said no · ready when you are",
  tone: "neutral",
  attention: "none",
  refused: true,
};

const ASKS_FOR_REPLY =
  /\b(please (allow|let me know|tell me|confirm|choose|pick|say|send|share|decide)|let me know|which (one|ones|of these|would|should|do)|would you (like|prefer|rather)|do you want|should i|shall i|can you|could you|what would you like|your (choice|call|decision|pick)|up to you|tell me (which|what|how|whether)|confirm (that|whether|which)|before i (go ahead|continue|change|proceed))\b/i;

/**
 * True when the Crew's last message is really a question for the person —
 * it ends on a question mark or asks for an answer in so many words — so a
 * finished run must not read as "All done".
 */
export function asksForReply(text: string): boolean {
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`>#]/g, "")
    .trim();
  if (clean.length === 0) return false;
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const tail = sentences.slice(-3);
  if (tail.some((sentence) => sentence.endsWith("?"))) return true;
  return ASKS_FOR_REPLY.test(tail.join(" "));
}

export function describeThreadStatus(
  shell: EnvironmentThreadShell,
  options: ThreadStatusOptions = {},
): ConversationStatus {
  const runtimeStatus = shell.runtime?.status ?? "idle";
  const live =
    runtimeStatus === "preparing" ||
    runtimeStatus === "queued" ||
    runtimeStatus === "starting" ||
    runtimeStatus === "running" ||
    runtimeStatus === "waiting";
  // Stop was pressed: the provider may take a while to confirm, but nothing
  // will run and no ask can be answered, so every surface says so at once.
  if (live && shell.source.latestRunStopRequested === true) {
    return {
      kind: "stopped",
      headline: "Stopping…",
      presence: "Stopping · nothing else will run",
      tone: "neutral",
      attention: "none",
    };
  }
  if (shell.hasPendingApprovals) {
    return {
      kind: "waiting",
      headline: options.childView
        ? "Waiting for a grown-up"
        : "Waiting for you · needs your OK before it carries on",
      presence: options.childView
        ? "Waiting for a grown-up"
        : "Waiting for you · nothing runs until you answer",
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
      kind: "plan",
      headline: options.childView
        ? "Your plan is ready"
        : "Waiting for you · the plan is ready to approve",
      presence: options.childView ? "Plan ready · press Build it" : "Waiting for you · plan ready",
      tone: "waiting",
      attention: "waiting",
    };
  }
  switch (runtimeStatus) {
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
  // A lined-up message taken back before it started ends as a cancelled run that never began and
  // had no Stop pressed: nobody stopped anything, so it reads like the turn before it.
  const takenBack =
    run.status === "cancelled" &&
    run.startedAt == null &&
    shell.source.latestRunStopRequested !== true;
  switch (takenBack ? "completed" : run.status) {
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
      const latest = shell.source.latestVisibleMessage;
      if (latest !== null && latest.role === "assistant" && asksForReply(latest.text)) {
        return {
          kind: "waiting",
          headline: "Waiting for you · needs your reply",
          presence: "Waiting for you · it asked you something",
          tone: "waiting",
          attention: "waiting",
          needsReply: true,
        };
      }
      if (
        run.status === "completed" &&
        (options.refused === true ||
          (latest !== null && latest.role === "assistant" && saysRefused(latest.text)))
      ) {
        return { ...REFUSED_STATUS };
      }
      const unseen = !takenBack && isUnseenSince(shell.lastVisitedAt, run.completedAt);
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

/**
 * "Crew: Done — GST is on the invoice total." / "You: add a vegan option".
 * `crewName` is the theme's builder ("Sam" in Workshop); the default keeps the
 * neutral name for callers outside React.
 */
export function conversationPreview(
  shell: EnvironmentThreadShell,
  status: ConversationStatus,
  crewName: string = CREW_NAME,
) {
  const latest = shell.source.latestVisibleMessage;
  if (status.needsReply && latest !== null && latest.text.trim().length > 0) {
    return `${crewName} asks: ${firstLine(latest.text)}`;
  }
  if (
    status.kind === "waiting" ||
    status.kind === "working" ||
    status.kind === "preparing" ||
    status.refused === true ||
    status.headline === "Stopping…"
  ) {
    return `${crewName}: ${status.headline}`;
  }
  if (latest !== null && latest.text.trim().length > 0) {
    const who = latest.role === "user" ? "You" : crewName;
    return `${who}: ${firstLine(latest.text)}`;
  }
  return `${crewName}: ${status.headline}`;
}

export function conversationTitle(shell: EnvironmentThreadShell): string {
  const title = shell.title.trim();
  if (title.length > 0) return promptTitle(title);
  const latest = shell.source.latestVisibleMessage;
  if (latest && latest.role === "user") return promptTitle(firstLine(latest.text, 80));
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
