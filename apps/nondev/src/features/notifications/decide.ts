// Which moments ping, and what the ping says. Pure: the coordinator feeds it the shell list
// (no per-thread subscription) and turns its answers into OS notifications.
//
// Adapted from T3's stock ThreadNotificationCoordinator (apps/web/src/components): one mark per
// conversation, compared with the last one seen, so a moment pings once and a page load never
// pings for old news. SKYCOT's differences: it reads our plain status (a question asked as a plain
// message, a refusal and a ready plan count), it splits "needs your OK" from "needs a grown-up",
// and the words name the crew and the project only. Never the message, a file, the conversation
// title (the AI writes it from the message) or anyone's details: a notification can show on a
// locked screen, and on a shared Mac anyone walking past can read it.
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { ConversationStatus } from "../conversation/status";

export type NotifyEvent =
  | "finished"
  | "plan"
  | "needs-ok"
  | "needs-grown-up"
  | "question"
  | "failed";

/** The three switches in Settings › Notifications. */
export type NotifyGroup = "finished" | "needsOk" | "failed";

export function groupOf(event: NotifyEvent): NotifyGroup {
  switch (event) {
    case "finished":
      return "finished";
    case "failed":
      return "failed";
    case "plan":
    case "needs-ok":
    case "needs-grown-up":
    case "question":
      return "needsOk";
  }
}

export interface ThreadMark {
  /** Names the current "waiting for you" moment, so each one pings once. */
  readonly attention: string | null;
  readonly attentionEvent: Exclude<NotifyEvent, "finished" | "needs-grown-up"> | null;
  /** When the latest run finished on its own (milliseconds), for "finished". */
  readonly completion: number | null;
  /** The ask waiting for an answer, when one is (a grown-up's card is one of these). */
  readonly requestId: string | null;
}

/** What one conversation looks like for notifications right now. */
export function markFor(shell: EnvironmentThreadShell, status: ConversationStatus): ThreadMark {
  const runId = shell.latestRun?.runId ?? "";
  const requestId = shell.source.pendingRuntimeRequest?.id ?? null;
  const attention: Pick<ThreadMark, "attention" | "attentionEvent"> = shell.hasPendingApprovals
    ? { attention: `${runId}:approval:${requestId ?? ""}`, attentionEvent: "needs-ok" }
    : shell.hasPendingUserInput
      ? { attention: `${runId}:question:${requestId ?? ""}`, attentionEvent: "question" }
      : shell.hasActionableProposedPlan
        ? { attention: `${runId}:plan`, attentionEvent: "plan" }
        : status.kind === "failed"
          ? { attention: `${runId}:failed`, attentionEvent: "failed" }
          : status.needsReply === true
            ? { attention: `${runId}:reply`, attentionEvent: "question" }
            : { attention: null, attentionEvent: null };
  const completedAt = Date.parse(shell.latestRun?.completedAt ?? "");
  const finished =
    shell.latestRun?.status === "completed" &&
    shell.source.latestRunStopRequested !== true &&
    status.refused !== true &&
    Number.isFinite(completedAt);
  return {
    ...attention,
    completion: finished ? completedAt : null,
    requestId: shell.hasPendingApprovals ? requestId : null,
  };
}

/** What a conversation started while this page was watching counted from: nothing yet. */
export const EMPTY_MARK: ThreadMark = {
  attention: null,
  attentionEvent: null,
  completion: null,
  requestId: null,
};

/**
 * The mark to compare a conversation with the first time the page sees it. One that already
 * existed when the page opened is old news (undefined: no ping). One created after the page
 * started watching counts from empty: a short turn can finish before its conversation reaches the
 * list, and that "finished" is still news.
 */
export function firstSeenMark(createdAt: string, watchingSince: number): ThreadMark | undefined {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created >= watchingSince ? EMPTY_MARK : undefined;
}

/**
 * The moment to ping for, if any. Nothing the first time a conversation is seen (a reload is
 * not news), and a run that ends waiting for you pings for that, not also for "finished".
 */
export function decide(prior: ThreadMark | undefined, next: ThreadMark): NotifyEvent | null {
  if (prior === undefined) return null;
  if (next.attention !== null && next.attention !== prior.attention) return next.attentionEvent;
  if (
    next.attention === null &&
    next.completion !== null &&
    (prior.completion === null || next.completion > prior.completion)
  ) {
    return "finished";
  }
  return null;
}

/**
 * How long a conversation stays quiet after a ping of one kind. One build once sent 17 "needs your
 * OK" pings, one per step; a person needs to hear about it once, not watch a stack grow.
 */
export const NOTIFY_WINDOW_MS = 3 * 60_000;

/**
 * Pings that throttle together. "Needs your OK" and "needs a grown-up" are one kind: a build asks
 * step after step and only the step waiting now matters (a conversation waits on one at a time).
 */
export type NotifyKind = "finished" | "failed" | "asks" | "plan" | "question";

export function kindOf(event: NotifyEvent): NotifyKind {
  switch (event) {
    case "needs-ok":
    case "needs-grown-up":
      return "asks";
    default:
      return event;
  }
}

export type ThrottleAnswer =
  | { readonly send: "now" }
  | { readonly send: "later"; readonly at: number };

/**
 * At most one ping per conversation and kind in each window. One inside the window waits for the
 * window's end, replacing any ping already waiting there, so the one that goes out is the latest.
 */
export function throttle(
  lastSentAt: number | undefined,
  now: number,
  windowMs: number = NOTIFY_WINDOW_MS,
): ThrottleAnswer {
  return lastSentAt === undefined || now - lastSentAt >= windowMs
    ? { send: "now" }
    : { send: "later", at: lastSentAt + windowMs };
}

/**
 * Whether a ping held back by the window still says something true when its turn comes: the
 * same step is still waiting (nobody answered it), or the finish is still the latest news.
 */
export function stillNews(event: NotifyEvent, then: ThreadMark, now: ThreadMark | undefined) {
  if (now === undefined) return false;
  return event === "finished"
    ? now.attention === null && now.completion === then.completion
    : now.attention === then.attention;
}

export interface NotificationText {
  readonly title: string;
  readonly body: string;
}

/**
 * The words. Built from the crew's name and the project's name and nothing else, so there is no
 * way for a message, a file or a conversation title to reach the lock screen.
 */
export function notificationText(
  event: NotifyEvent,
  { builder, project }: { readonly builder: string; readonly project: string | null },
): NotificationText {
  const name = project?.trim() || null;
  const inProject = name === null ? "" : ` in ${name}`;
  switch (event) {
    case "finished":
      return { title: `${builder}'s finished${inProject}`, body: "Open it to have a look." };
    case "plan":
      return {
        title: `${builder} has a plan${name === null ? "" : ` for ${name}`}`,
        body: "Have a look, then press Build it or change it.",
      };
    case "needs-ok":
      return {
        title: `${builder} needs your OK${inProject}`,
        body: "Nothing happens until you answer.",
      };
    case "needs-grown-up":
      return {
        title: `${builder} needs a grown-up${inProject}`,
        body: "A step is waiting for the parent code.",
      };
    case "question":
      return { title: `${builder} has a question${inProject}`, body: "Answer it to carry on." };
    case "failed":
      return {
        title: `Something went wrong${inProject}`,
        body: `${builder} stopped. Open it to try again.`,
      };
  }
}
