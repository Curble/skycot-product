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

import { useCrew } from "../../themes/useCrew";
import { useChildView } from "../../app/useChildView";
import { useElapsedLabel } from "../../app/useElapsed";
import { describeDecision } from "../../plain/approvals";
import { filesFromPrompt } from "../../plain/changes";
import { progress } from "../../plain/copy";
import { wasCarriedOn } from "../../plain/switches";
import {
  askBeforeItsStep,
  commandInputsOf,
  describeTurnItem,
  progressHint,
  retriedFailures,
  summarizeRun,
  type NarrationContext,
} from "../../plain/narration";
import { asksForGame } from "../badges/facts";
import { childProgressSentence } from "./childProgress";
import { isAssistantRefusal } from "../family/assistantAllowance";
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

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

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
export type AskItem = Extract<
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
  const childView = useChildView();
  const builderName = useCrew().builder.name;
  // environmentId / threadId stay in the signature for the stream's call site;
  // the card itself no longer dispatches anything (Stop moved to the header).
  void environmentId;
  void threadId;
  const run = group.runId === null ? undefined : projection.runs.find((r) => r.id === group.runId);
  const requests = new Map(projection.runtimeRequests.map((r) => [r.id, r]));
  const stopped = run?.status === "interrupted" || run?.status === "cancelled";
  const deletedPaths = new Set(
    projection.turnItems.flatMap((item) =>
      item.type === "approval_request" &&
      item.runId === group.runId &&
      item.requestKind === "file-change"
        ? filesFromPrompt(item.prompt)
            .filter((file) => file.operation === "remove")
            .map((file) => file.path)
        : [],
    ),
  );
  // A child's lines use kid words; "Testing your game" when the first ask was for a game.
  const kid = useChildView();
  const firstAsk = kid
    ? projection.turnItems
        .filter((item) => item.type === "user_message" && item.createdBy === "user")
        .reduce<(typeof projection.turnItems)[number] | undefined>(
          (first, item) => (first === undefined || item.ordinal < first.ordinal ? item : first),
          undefined,
        )
    : undefined;
  const kidThing =
    firstAsk?.type === "user_message" && asksForGame(firstAsk.text) ? "game" : "page";
  const ctx: NarrationContext = {
    ...(kid ? { kid: true, kidThing } : {}),
    ...(projectName === null ? {} : { projectName }),
    runtimeRequests: requests,
    ...(stopped ? { stopped: true } : {}),
    ...(deletedPaths.size > 0 ? { deletedPaths } : {}),
    commandInputs: commandInputsOf(projection.turnItems),
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
  const runActive = run
    ? ACTIVE_RUN.has(run.status)
    : group.items.some((item) => describeTurnItem(item, ctx).status === "running");
  const pendingAsk = runAsks.some(
    (item) => item.type === "approval_request" && requests.get(item.requestId)?.resolvedAt === null,
  );
  const active = runActive && !(childView && pendingAsk);
  const narrated = group.items.map((item) => {
    const narration = describeTurnItem(item, ctx);
    // A run that was stopped leaves its unfinished steps "about to …": they never ran.
    if (stopped && (narration.status === "pending" || narration.status === "running")) {
      return {
        item,
        narration: {
          ...narration,
          status: "denied" as const,
          headline: `Cancelled: ${lowerFirst(narration.headline.replace(/^(About to|The assistant wants to) /, ""))}`,
        },
      };
    }
    return { item, narration };
  });
  // Asks the SKYCOT rules answered sit in this card's details only; they are not steps.
  const toolItems = group.items.filter((item) => item.type !== "approval_request");
  const { checklist: rawChecklist } = summarizeRun(toolItems, ctx);
  const kidLine = (text: string) => {
    if (!kid) return text;
    const item = [...toolItems].reverse().find((candidate) => {
      const narration = describeTurnItem(candidate, ctx);
      return narration.headline === text;
    });
    return childProgressSentence(item ? describeTurnItem(item, ctx).kind : "other");
  };
  const checklist = kid
    ? {
        done: rawChecklist.done.map(kidLine),
        now: rawChecklist.now.map(kidLine),
        next: rawChecklist.next.map(kidLine),
      }
    : rawChecklist;
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
      item.type !== "reasoning" &&
      item.type !== "todo_list" &&
      item.type !== "approval_request" &&
      // The engine's own set-up of the private copy is not one of the Crew's steps.
      !(item.type === "command_execution" && /^preparing workspace$/i.test(item.input.trim())) &&
      narration.status !== "denied",
  ).length;
  // A step that failed and was then redone successfully in this run is not a failure.
  const retried = retriedFailures(toolItems, ctx);
  const failed = narrated.filter(
    (n) => n.narration.status === "failed" && !retried.has(n.item.id),
  ).length;
  const deniedAsks = runAsks.filter((item) => {
    const request = requests.get(item.requestId);
    return request?.decision === "decline";
  }).length;
  // Same rule as the header and the list (endedOnRefusal): a "no" and no files changed.
  const refused = run !== undefined && endedOnRefusal(projection, run.id);

  const startMillis = toIso(run?.workStartedAt ?? run?.startedAt ?? run?.requestedAt ?? null);
  const waited = waitedMillis(runAsks, requests);
  const elapsed = useElapsedLabel(
    startMillis === null ? null : new Date(Date.parse(startMillis) + waited).toISOString(),
    toIso(run?.completedAt ?? null),
    active && !childView,
  );
  const rawHint = progressHint(toolItems, run?.status ?? "running", ctx);
  const latestRunning = [...toolItems].reverse().find((item) => {
    const narration = describeTurnItem(item, ctx);
    return (
      narration.status === "running" &&
      narration.kind !== "message" &&
      narration.kind !== "reasoning"
    );
  });
  const hint =
    kid && latestRunning
      ? childProgressSentence(describeTurnItem(latestRunning, ctx).kind)
      : rawHint;
  // "Working on it" is already the title; saying it three times tells nothing.
  const genericHint = hint.replace(/[.…]+$/, "") === progress.working.replace(/[.…]+$/, "");

  const doneSoFar = checklist.done.length;
  const planDone =
    childView &&
    run?.status === "completed" &&
    !run.sourcePlanRef &&
    projection.turnItems.some((item) => item.runId === run.id && item.type === "proposed_plan");
  const subtitleParts =
    pendingAsk && childView
      ? []
      : active
        ? [
            total > 0
              ? `Step ${stepNow} of ${total}`
              : doneSoFar > 0
                ? `${doneSoFar} ${doneSoFar === 1 ? "step" : "steps"} done so far`
                : genericHint
                  ? "Just started"
                  : hint.replace(/[.…]+$/, ""),
            childView ? null : elapsed,
          ]
        : [
            refused || (stopped && stepCount === 0)
              ? "Nothing was changed"
              : stepCount === 0
                ? "No files touched"
                : `${stepCount} ${stepCount === 1 ? "step" : "steps"}`,
            childView ? null : elapsed,
          ];
  const subtitle = subtitleParts.filter((part): part is string => !!part).join(" · ");

  const detailLines = askBeforeItsStep(narrated).map(({ item, narration }) => {
    // The headline already says "SKYCOT rules allowed …" for policy answers;
    // the technical line names who decided so the log reads the same way.
    const request = "requestId" in item ? requests.get(item.requestId) : undefined;
    const decision = request ? describeDecision(request) : null;
    return {
      key: item.id,
      time: shortTime(item.startedAt ?? item.updatedAt),
      label: narration.headline,
      text:
        decision?.decidedBy === "policy"
          ? `${narration.technical}\n— ${decision.label}`
          : narration.technical,
      tone:
        narration.status === "failed"
          ? ("failed" as const)
          : narration.status === "denied"
            ? ("denied" as const)
            : undefined,
      prose: narration.kind === "reasoning" || narration.kind === "message",
    };
  });

  // Checklist lines are plain strings and can repeat ("Ran a check" twice).
  const seen = new Map<string, number>();
  const rowKey = (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };

  // A limit stopped it and SKYCOT carried the turn on with another model (plain line below).
  const carriedOn = !active && run?.status === "failed" && wasCarriedOn(projection, run.id);
  const headerTone =
    pendingAsk && childView
      ? "orange"
      : active
        ? "blue"
        : carriedOn
          ? "orange"
          : run?.status === "failed" && !refusedByFamily(projection, run.id)
            ? "red"
            : failed > 0 || refused || run?.status === "failed"
              ? "orange"
              : "green";
  // The Family profile turned the assistant away before it started (nobody allowed it): the
  // grown-up card below says so, so this card is a calm note, not "something went wrong".
  const awaitingGrownUp =
    !active && run?.status === "failed" && refusedByFamily(projection, run.id);
  const title =
    pendingAsk && childView
      ? "Paused — waiting for a grown-up"
      : active
        ? "Working on it"
        : awaitingGrownUp
          ? "Waiting for a grown-up"
          : carriedOn
            ? "Paused here, carried on below"
            : planDone
              ? `${builderName} made a plan`
              : finishedTitle(run?.status, refused);
  const icon = carriedOn
    ? Hammer
    : awaitingGrownUp
      ? HandMetal
      : run?.status === "failed" && !active
        ? CircleAlert
        : refused
          ? HandMetal
          : Hammer;

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
          ) : planDone ? (
            <p className="fm-work__hint">The plan is ready. Press Build it when you’re ready.</p>
          ) : refused ? (
            <p className="fm-work__hint">
              You said no to {deniedAsks === 1 ? "a step" : `${deniedAsks} steps`}, so nothing in
              the project was changed. Reply below to say what you'd like instead.
            </p>
          ) : run?.status === "failed" && failed > 0 ? (
            <p className="fm-work__hint">
              {failed === 1 ? "One step didn't work" : `${failed} steps didn't work`} — the details
              below say which.
            </p>
          ) : run?.status === "completed" && retried.size > 0 ? (
            <p className="fm-work__hint">
              {retried.size === 1 ? "1 step" : `${retried.size} steps`} needed a second try.
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

/**
 * A run that ended because the person said no to a step, and changed nothing,
 * is a stop, not a success. Shared by the Working card, the header and (via
 * state/conversations) the list.
 */
/** The run ended because the Family profile turned away an assistant nobody allowed. */
function refusedByFamily(projection: OrchestrationV2ThreadProjection, runId: string): boolean {
  return projection.turnItems.some(
    (item) =>
      item.type === "error" && item.runId === runId && isAssistantRefusal(item.failure.message),
  );
}

export function endedOnRefusal(
  projection: OrchestrationV2ThreadProjection,
  latestRunId: string | null,
): boolean {
  if (latestRunId === null) return false;
  const run = projection.runs.find((candidate) => candidate.id === latestRunId);
  if (!run || run.status !== "completed") return false;
  const declined = projection.turnItems.some(
    (item) =>
      item.type === "approval_request" &&
      item.runId === run.id &&
      projection.runtimeRequests.find((request) => request.id === item.requestId)?.decision ===
        "decline",
  );
  if (!declined) return false;
  return !projection.checkpoints.some(
    (checkpoint) => checkpoint.runId === run.id && checkpoint.files.length > 0,
  );
}
