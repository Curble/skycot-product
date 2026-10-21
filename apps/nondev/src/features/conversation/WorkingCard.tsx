// The "Working on it" card: one per run, fed by every tool-ish item the run
// produced. Live it shows step N of M, the done/now/next checklist and a Stop
// button; finished it collapses to "Done · N steps" with the developer
// disclosure. Cost is never shown because the engine does not report dollars.
import type {
  EnvironmentId,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  ThreadId,
} from "@t3tools/contracts";
import { CircleAlert, Hammer, Square } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { useElapsedLabel } from "../../app/useElapsed";
import { progress } from "../../plain/copy";
import {
  describeTurnItem,
  progressHint,
  summarizeRun,
  type NarrationContext,
} from "../../plain/narration";
import { threadEnvironment } from "../../state/threads";
import { Bubble } from "../../ui/Bubble";
import { Button } from "../../ui/Button";
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

function finishedTitle(status: OrchestrationV2Run["status"] | undefined): string {
  switch (status) {
    case "failed":
      return "Stopped — something went wrong";
    case "interrupted":
    case "cancelled":
      return "Stopped";
    case "rolled_back":
      return "Restored to an earlier version";
    default:
      return "Done";
  }
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
  const run = group.runId === null ? undefined : projection.runs.find((r) => r.id === group.runId);
  const ctx: NarrationContext = {
    ...(projectName === null ? {} : { projectName }),
    runtimeRequests: new Map(projection.runtimeRequests.map((r) => [r.id, r])),
  };
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
  // Thinking and the to-do list are bookkeeping, not steps the user would count.
  const stepCount = group.items.filter(
    (item) => item.type !== "reasoning" && item.type !== "todo_list",
  ).length;
  const failed = narrated.filter((n) => n.narration.status === "failed").length;

  const elapsed = useElapsedLabel(
    toIso(run?.workStartedAt ?? run?.startedAt ?? run?.requestedAt ?? null),
    toIso(run?.completedAt ?? null),
    active,
  );
  const hint = progressHint(group.items, run?.status ?? "running", ctx);

  const doneSoFar = checklist.done.length;
  const subtitleParts = active
    ? [
        total > 0
          ? `Step ${stepNow} of ${total}`
          : doneSoFar > 0
            ? `${doneSoFar} ${doneSoFar === 1 ? "step" : "steps"} done so far`
            : hint.replace(/[.…]+$/, ""),
        elapsed,
      ]
    : [
        stepCount === 0 ? "No files touched" : `${stepCount} ${stepCount === 1 ? "step" : "steps"}`,
        elapsed,
      ];
  const subtitle = subtitleParts.filter((part): part is string => !!part).join(" · ");

  const detailLines = narrated.map(({ item, narration }) => ({
    key: item.id,
    time: shortTime(item.startedAt ?? item.updatedAt),
    label: narration.headline,
    text: narration.technical,
    tone:
      narration.status === "failed"
        ? ("failed" as const)
        : narration.status === "denied"
          ? ("denied" as const)
          : undefined,
  }));

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
      : failed > 0
        ? "orange"
        : "green";

  return (
    <Bubble author="crew" full meta={active ? undefined : shortTime(run?.completedAt ?? null)}>
      <Card label={active ? "Working on it" : finishedTitle(run?.status)}>
        <CardHeader
          icon={active || run?.status !== "failed" ? Hammer : CircleAlert}
          tone={headerTone}
          title={active ? "Working on it" : finishedTitle(run?.status)}
          subtitle={subtitle}
          trailing={
            active ? (
              <StopButton environmentId={environmentId} threadId={threadId} run={run} />
            ) : null
          }
        />
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
                <p className="fm-work__hint">{hint}</p>
              )}
            </>
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

function StopButton({
  environmentId,
  threadId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly run: OrchestrationV2Run | undefined;
}) {
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="destructive"
      size="sm"
      icon={Square}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await interrupt({ environmentId, input: { threadId, ...(run ? { runId: run.id } : {}) } });
        setBusy(false);
      }}
    >
      {busy ? "Stopping…" : "Stop"}
    </Button>
  );
}
