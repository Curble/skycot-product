// The "Working on it" card: one per run, fed by every tool-ish item the run
// produced. Live it shows step N of M and the done/now/next checklist (the
// Stop control lives in the header, so there is one on screen); finished it
// collapses to "Done · N steps" with the developer disclosure. Cost is never
// shown because the engine does not report dollars.
import type {
  EnvironmentId,
  OrchestrationV2Run,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { CircleAlert, Hammer, HandMetal } from "lucide-react";

import { useElapsedLabel } from "../../app/useElapsed";
import { progress } from "../../plain/copy";
import {
  describeTurnItem,
  progressHint,
  summarizeRun,
  type NarrationContext,
} from "../../plain/narration";
import { Bubble } from "../../ui/Bubble";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { ProgressBar } from "../../ui/ProgressBar";
import { StepBadge } from "../../ui/StepBadge";
import { Disclosure, TechnicalList } from "./cards/Disclosure";
import type { WorkGroup } from "./cards/grouping";
import { shortTime, toIso } from "./cards/time";

const ACTIVE_RUN = new Set<OrchestrationV2Run["status"]>([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function finishedTitle(status: OrchestrationV2Run["status"] | undefined, refused: boolean): string {
  switch (status) {
    case "failed":
      return "Stopped — something went wrong";
    case "interrupted":
    case "cancelled":
      return "Stopped";
    case "rolled_back":
      return "Restored to an earlier version";
    default:
      return refused ? "Stopped — you said no to a step" : "Done";
  }
}

/**
 * Time the run spent waiting on a person is not work. Settled requests shift
 * the clock's start forward by how long each waited; a still-pending request
 * keeps ticking (the strip shows the same figure), which is honest enough for
 * a Polish item without a second timer.
 */
type AskItem = Extract<
  OrchestrationV2TurnItem,
  { type: "approval_request" } | { type: "user_input_request" }
>;

export function waitedMillis(
  items: ReadonlyArray<AskItem>,
  requests: ReadonlyMap<string, OrchestrationV2RuntimeRequest>,
): number {
  let total = 0;
  for (const item of items) {
    const request = requests.get(item.requestId);
    if (!request || request.resolvedAt === null) continue;
    total += Math.max(
      0,
      DateTime.toEpochMillis(request.resolvedAt) - DateTime.toEpochMillis(request.createdAt),
    );
  }
  return total;
}

/**
 * Requests the engine answered on the person's behalf carry a note once
 * approval rules land server-side. Read defensively: the field is optional
 * today and absent on older servers.
 */
export function decisionNoteOf(request: unknown): string | null {
  if (typeof request !== "object" || request === null) return null;
  const note = (request as { readonly decisionNote?: unknown }).decisionNote;
  return typeof note === "string" && note.trim().length > 0 ? note.trim() : null;
}

export function WorkingCard({
  group,
  projection,
  environmentId,
  threadId,
  projectName,
}: {
  readonly group: WorkGroup;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectName: string | null;
}) {
  // environmentId / threadId stay in the signature for the stream's call site;
  // the card itself no longer dispatches anything (Stop moved to the header).
  void environmentId;
  void threadId;
  const run = group.runId === null ? undefined : projection.runs.find((r) => r.id === group.runId);
  const requests = new Map(projection.runtimeRequests.map((r) => [r.id, r]));
  const ctx: NarrationContext = {
    ...(projectName === null ? {} : { projectName }),
    runtimeRequests: requests,
  };
  // Approval cards are their own stream items, but the run's asks still count
  // for the clock and for "you said no" — the checklist and tool items come
  // from this run's items only.
  const runAsks =
    group.runId === null
      ? []
      : projection.turnItems.filter(
          (item): item is AskItem =>
            item.runId === group.runId &&
            (item.type === "approval_request" || item.type === "user_input_request"),
        );
  const narrated = group.items.map((item) => ({ item, narration: describeTurnItem(item, ctx) }));
  const active = run
    ? ACTIVE_RUN.has(run.status)
    : narrated.some((n) => n.narration.status === "running");
  const { checklist } = summarizeRun(group.items, ctx);
  // "Step N of M" is only honest when the agent published a to-do list; a
  // checklist inferred from tool calls has no known end.
  const planned = group.items.some((item) => item.type === "todo_list" && item.steps.length > 0);
  const total = planned ? checklist.done.length + checklist.now.length + checklist.next.length : 0;
  const stepNow = Math.min(
    total,
    Math.max(1, checklist.done.length + (checklist.now.length > 0 ? 1 : 0)),
  );
  // Thinking and the to-do list are bookkeeping, not steps the user would
  // count; a step the person refused never happened.
  const stepCount = narrated.filter(
    ({ item, narration }) =>
      item.type !== "reasoning" && item.type !== "todo_list" && narration.status !== "denied",
  ).length;
  const failed = narrated.filter((n) => n.narration.status === "failed").length;
  const deniedAsks = runAsks.filter((item) => {
    const request = requests.get(item.requestId);
    return request?.decision === "decline";
  }).length;
  const refused = run?.status === "completed" && deniedAsks > 0 && stepCount === 0;

  const startMillis = toIso(run?.workStartedAt ?? run?.startedAt ?? run?.requestedAt ?? null);
  const waited = waitedMillis(runAsks, requests);
  const elapsed = useElapsedLabel(
    startMillis === null ? null : new Date(Date.parse(startMillis) + waited).toISOString(),
    toIso(run?.completedAt ?? null),
    active,
  );
  const hint = progressHint(group.items, run?.status ?? "running", ctx);
  // "Working on it" is already the title; saying it three times tells nothing.
  const genericHint = hint.replace(/[.…]+$/, "") === progress.working.replace(/[.…]+$/, "");

  const doneSoFar = checklist.done.length;
  const subtitleParts = active
    ? [
        total > 0
          ? `Step ${stepNow} of ${total}`
          : doneSoFar > 0
            ? `${doneSoFar} ${doneSoFar === 1 ? "step" : "steps"} done so far`
            : genericHint
              ? "Just started"
              : hint.replace(/[.…]+$/, ""),
        elapsed,
      ]
    : [
        refused
          ? "Nothing was changed"
          : stepCount === 0
            ? "No files touched"
            : `${stepCount} ${stepCount === 1 ? "step" : "steps"}`,
        elapsed,
      ];
  const subtitle = subtitleParts.filter((part): part is string => !!part).join(" · ");

  const detailLines = narrated.map(({ item, narration }) => {
    const note = "requestId" in item ? decisionNoteOf(requests.get(item.requestId)) : null;
    return {
      key: item.id,
      time: shortTime(item.startedAt ?? item.updatedAt),
      label: note ? `${narration.headline} · ${note}` : narration.headline,
      text: narration.technical,
      tone:
        narration.status === "failed"
          ? ("failed" as const)
          : narration.status === "denied"
            ? ("denied" as const)
            : undefined,
    };
  });

  // Checklist lines are plain strings and can repeat ("Ran a check" twice).
  const seen = new Map<string, number>();
  const rowKey = (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };

  const headerTone = active
    ? "blue"
    : run?.status === "failed"
      ? "red"
      : failed > 0 || refused
        ? "orange"
        : "green";
  const title = active ? "Working on it" : finishedTitle(run?.status, refused);
  const icon = run?.status === "failed" && !active ? CircleAlert : refused ? HandMetal : Hammer;

  return (
    <Bubble author="crew" full meta={active ? undefined : shortTime(run?.completedAt ?? null)}>
      <Card label={title}>
        <CardHeader icon={icon} tone={headerTone} title={title} subtitle={subtitle} />
        <CardBody>
          {active ? (
            <>
              {total > 0 ? (
                <div className="fm-work__progress">
                  <ProgressBar
                    value={checklist.done.length + (checklist.now.length > 0 ? 0.5 : 0)}
                    max={total}
                    thin
                    label={`Step ${stepNow} of ${total}`}
                    tone="accent"
                  />
                </div>
              ) : null}
              {checklist.done.length + checklist.now.length + checklist.next.length > 0 ? (
                <ol className="fm-rows" aria-label="Steps">
                  {checklist.done.slice(-6).map((text) => (
                    <li key={rowKey(`done:${text}`)} className="fm-rows__row">
                      <StepBadge state="done" label="Done" />
                      <span className="fm-rows__text">{text}</span>
                    </li>
                  ))}
                  {checklist.now.map((text) => (
                    <li key={rowKey(`now:${text}`)} className="fm-rows__row fm-rows__row--now">
                      <StepBadge state="now" label="Now" />
                      <span className="fm-rows__text">
                        <b>{text}</b>
                      </span>
                      <span className="fm-rows__time">now</span>
                    </li>
                  ))}
                  {checklist.next.map((text, index) => (
                    <li key={rowKey(`next:${text}`)} className="fm-rows__row fm-rows__row--todo">
                      <StepBadge state="todo">
                        {checklist.done.length + checklist.now.length + index + 1}
                      </StepBadge>
                      <span className="fm-rows__text fm-rows__text--dim">{text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="fm-work__hint">
                  {genericHint ? "The first steps will appear here." : hint}
                </p>
              )}
            </>
          ) : refused ? (
            <p className="fm-work__hint">
              You said no to {deniedAsks === 1 ? "a step" : `${deniedAsks} steps`}, so nothing in
              the project was changed. Reply below to say what you'd like instead.
            </p>
          ) : failed > 0 ? (
            <p className="fm-work__hint">
              {failed === 1 ? "One step didn't work" : `${failed} steps didn't work`} — the details
              below say which.
            </p>
          ) : run?.status === "completed" && stepCount === 0 ? (
            <p className="fm-work__hint">{progress.allDone} Nothing in the project was changed.</p>
          ) : null}
          <Disclosure>
            <TechnicalList lines={detailLines} />
          </Disclosure>
        </CardBody>
      </Card>
    </Bubble>
  );
}
