import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  ChevronLeft,
  Clock,
  MessageSquareDashed,
  Receipt,
  ShieldAlert,
  Square,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { ProjectAvatar } from "../../app/ProjectAvatar";
import { useElapsedLabel } from "../../app/useElapsed";
import { HOME_HREF } from "../../router";
import { refusedRunIdsAtom, withRefusedRun } from "../../state/conversations";
import { projectAtomOrEmpty } from "../../state/projects";
import { canOperateEnvironmentAtom } from "../../state/session";
import {
  environmentThreads,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { CrewAvatar } from "../../themes/CrewAvatar";
import { useCrew } from "../../themes/useCrew";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { TypingIndicator } from "../../ui/Bubble";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { ProgressBar } from "../../ui/ProgressBar";
import { autonomyForRuntimeMode, autonomyLabel } from "../compose/autonomy";
import { MessageField } from "../compose/MessageField";
import { useStartNote } from "../compose/startNotes";
import { PublishButton, PublishSheet, PublishStatusPill, usePublishOverview } from "../publish";
import { latestReviewable } from "../review";
import { describeThreadStatus, type ConversationStatus } from "./status";
import { Timeline } from "./Timeline";
import { waitedMillis, type AskItem } from "./WorkingCard";

/** Brings a What-changed card to the top of the stream; the card anchors itself by checkpoint id. */
function scrollToCheckpoint(checkpointId: string) {
  document
    .querySelector(`[data-checkpoint-id="${CSS.escape(checkpointId)}"]`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** True while the reader is at (or within a screenful of) the end of the stream. */
function readerIsNearBottom(): boolean {
  const scroller = document.querySelector<HTMLElement>(".fm-stream");
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
}

/**
 * A run that ended because the person said no to a step, and changed nothing,
 * is a stop, not a success. The shell cannot see decisions, so this reads the
 * full projection; the list row still relies on the Crew's closing message.
 */
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

/**
 * One conversation: contact header, status strip, the stream, and the reply
 * field. Subscribes to this thread only; the list column stays on shell data.
 */
export function ConversationView({
  environmentId,
  threadId,
  showBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly showBack: boolean;
}) {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  const shell = useAtomValue(environmentThreadShells.threadShellAtom({ environmentId, threadId }));
  const project = useAtomValue(projectAtomOrEmpty({ environmentId, projectId: shell?.projectId }));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const active = shell ? threadRuntimeIsActive(shell.runtime) : false;
  const latestRunId = shell?.latestRun?.runId ?? null;
  const refused =
    projection !== null && shell !== null && !active
      ? endedOnRefusal(projection, latestRunId)
      : false;
  const status: ConversationStatus | null = shell ? describeThreadStatus(shell, { refused }) : null;
  // Tell the list, which only has the shell, that this run ended on a refusal.
  const refusedRuns = useAtomValue(refusedRunIdsAtom);
  const setRefusedRuns = useAtomSet(refusedRunIdsAtom);
  useEffect(() => {
    if (!refused || latestRunId === null || refusedRuns.has(latestRunId)) return;
    setRefusedRuns(withRefusedRun(refusedRuns, latestRunId));
  }, [refused, latestRunId, refusedRuns, setRefusedRuns]);
  // Nothing is "working" while the Crew waits on an answer; the dots would lie.
  const waitingOnYou =
    shell !== null &&
    (shell.hasPendingApprovals || shell.hasPendingUserInput || shell.hasActionableProposedPlan);
  const crew = useCrew();
  const crewName = crew.builder.name;

  const visit = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  // Opening the conversation is what turns "ready to look at" into plain "done".
  const markVisited = useEffectEvent(() => {
    void visit({ environmentId, input: { threadId, visitedAt: new Date().toISOString() } });
  });
  const attention = status?.attention ?? null;
  useEffect(() => {
    if (canOperate && attention === "ready") markVisited();
  }, [canOperate, attention]);

  const startedAt = shell
    ? resolveThreadWorkingStartedAt({ latestRun: shell.latestRun, runtime: shell.runtime })
    : null;
  // Time spent waiting on the person is not work: the strip's clock matches the
  // Working card's (QA-P2-2-14).
  const runStart = startedAt ?? shell?.latestRun?.startedAt ?? null;
  const requestsById =
    projection === null
      ? null
      : new Map(projection.runtimeRequests.map((request) => [request.id, request]));
  const waited =
    projection !== null && requestsById !== null && latestRunId !== null && runStart !== null
      ? waitedMillis(
          projection.turnItems.filter(
            (item): item is AskItem =>
              item.runId === latestRunId &&
              (item.type === "approval_request" || item.type === "user_input_request") &&
              // Only waits inside the clock's window; an activity clock may already start after them.
              (requestsById.get(item.requestId)?.createdAt === undefined ||
                DateTime.toEpochMillis(requestsById.get(item.requestId)!.createdAt) >=
                  Date.parse(runStart)),
          ),
          requestsById,
        )
      : 0;
  const elapsed = useElapsedLabel(
    runStart === null || waited === 0
      ? runStart
      : new Date(Date.parse(runStart) + waited).toISOString(),
    shell?.latestRun?.completedAt ?? null,
    active,
  );

  const projectName = project?.title ?? null;

  // When a run finishes with file changes, its What-changed card is the thing
  // to read next: bring it into view once (on open, or when the reader is
  // already following the end of the stream), and keep a pill in the strip
  // that jumps back to it. Someone re-reading an earlier message is not moved.
  const latest = projection ? (latestReviewable(projection) ?? null) : null;
  const latestId = latest?.id ?? null;
  const seenLatest = useRef<string | null>(null);
  useEffect(() => {
    if (latestId === null || latestId === seenLatest.current) return;
    const firstSighting = seenLatest.current === null;
    seenLatest.current = latestId;
    if (firstSighting || readerIsNearBottom()) scrollToCheckpoint(latestId);
  }, [latestId, seenLatest]);
  const startNote = useStartNote(threadId);

  const [publishOpen, setPublishOpen] = useState(false);
  const publish = usePublishOverview({
    environmentId,
    threadId,
    shell,
    project,
    projection,
    active,
    canOperate,
  });

  return (
    <>
      <header className="fm-conv-header">
        {showBack ? (
          <IconButton
            icon={ChevronLeft}
            label="Back to conversations"
            onClick={() => (window.location.hash = HOME_HREF)}
          />
        ) : null}
        <CrewAvatar role="builder" size="lg" />
        <div className="fm-conv-header__who">
          <span className="fm-conv-header__name">
            {crewName}
            {projectName ? ` · ${projectName}` : ""}
          </span>
          <span className="fm-conv-header__presence">
            {status === null
              ? "Connecting…"
              : shell?.worktreePath
                ? // The private copy is the reassurance that matters; keep the
                  // first clause ("Working", "Waiting for you") and drop the rest.
                  `${status.presence.split(" · ")[0]} · in a private copy of your project`
                : status.presence}
          </span>
        </div>
        <div className="fm-conv-header__tools">
          {active ? (
            <StopButton
              environmentId={environmentId}
              threadId={threadId}
              runId={shell?.runtime?.activeRunId ?? null}
            />
          ) : null}
          <PublishButton readiness={publish.readiness} onClick={() => setPublishOpen(true)} />
          {project ? <ProjectAvatar project={project} size="md" /> : null}
        </div>
      </header>

      {shell && status ? (
        <div className="fm-strip fm-strip--wrap">
          <Pill tone={status.tone} size="sm">
            {latestId !== null && status.kind === "ready" ? "Done" : status.headline}
          </Pill>
          {latestId !== null && !active ? (
            <Pill
              tone="ok"
              size="sm"
              icon={Receipt}
              label="Jump to what changed"
              onClick={() => scrollToCheckpoint(latestId)}
            >
              Ready to look at
            </Pill>
          ) : null}
          {elapsed ? (
            <span className="fm-strip__time">
              <Clock size={13} strokeWidth={1.8} aria-hidden />
              {elapsed}
            </span>
          ) : null}
          <span className="fm-strip__dot">·</span>
          <span>{autonomyLabel(autonomyForRuntimeMode(shell.runtimeMode))}</span>
          {publish.status ? (
            <>
              <span className="fm-strip__dot">·</span>
              <PublishStatusPill status={publish.status} />
            </>
          ) : null}
          {active ? (
            <span className="fm-strip__grow">
              <ProgressBar value={1} max={1} thin label="Working" tone="accent" />
            </span>
          ) : null}
        </div>
      ) : null}

      {shell?.runtimeMode === "full-access" ? (
        <HandsOffStrip environmentId={environmentId} threadId={threadId} canOperate={canOperate} />
      ) : null}

      {state && Option.isSome(state.error) ? (
        <Banner tone="warning">
          <b>This conversation didn't load fully.</b> Trying again…
        </Banner>
      ) : null}

      {startNote && shell && shell.worktreePath === null ? (
        <Banner tone="info">{startNote}</Banner>
      ) : null}

      {projection === null ? (
        <div className="fm-stream">
          <EmptyState title="Opening the conversation…" />
        </div>
      ) : projection.turnItems.length === 0 ? (
        <div className="fm-stream">
          <EmptyState icon={MessageSquareDashed} title="Nothing has been said yet">
            Say what you'd like done and {crewName} will show you a plan first.
          </EmptyState>
        </div>
      ) : (
        <Timeline
          environmentId={environmentId}
          threadId={threadId}
          projection={projection}
          shell={shell}
          projectName={projectName}
          trailing={
            active &&
            !waitingOnYou &&
            !projection.turnItems.some(
              (item) => item.type === "assistant_message" && item.streaming,
            ) ? (
              <TypingIndicator meta={`${crewName} is working…`} />
            ) : null
          }
        />
      )}

      <ReplyComposer
        environmentId={environmentId}
        threadId={threadId}
        shell={shell}
        active={active}
      />

      <PublishSheet
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        environmentId={environmentId}
        threadId={threadId}
        shell={shell}
        project={project}
        projection={projection}
      />
    </>
  );
}

/** The one Stop control: in the header, always on screen while a run is live. */
function StopButton({
  environmentId,
  threadId,
  runId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
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
        await interrupt({ environmentId, input: { threadId, ...(runId ? { runId } : {}) } });
        setBusy(false);
      }}
    >
      {busy ? "Stopping…" : "Stop"}
    </Button>
  );
}

/**
 * Fully hands-off means no question is ever asked. The warning stays on screen
 * for the whole conversation, with the one-tap way back to "Ask me first".
 * The engine applies the new mode to the next thing the Crew asks about.
 */
function HandsOffStrip({
  environmentId,
  threadId,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canOperate: boolean;
}) {
  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const crew = useCrew();
  return (
    <div className="fm-handsoff" role="alert">
      <ShieldAlert size={15} strokeWidth={2} aria-hidden />
      <span className="fm-handsoff__text">
        <b>Hands-off: nothing is being checked.</b> {crew.builder.name} can delete files, publish or
        spend without asking you first.
        {state === "failed" ? " The switch didn't go through — try again." : ""}
      </span>
      {canOperate ? (
        <Button
          size="sm"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const outcome = await setRuntimeMode({
              environmentId,
              input: { threadId, runtimeMode: "approval-required" },
            });
            setState(outcome._tag === "Failure" ? "failed" : "idle");
          }}
        >
          {state === "busy" ? "Switching…" : "Switch to Ask me first"}
        </Button>
      ) : null}
    </div>
  );
}

function ReplyComposer({
  environmentId,
  threadId,
  shell,
  active,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly active: boolean;
}) {
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A note typed "while it works" is a steer, not a new paid request. If the
  // run ends before Return, the first Return asks instead of sending.
  const [typedWhileActive, setTypedWhileActive] = useState(false);
  const [confirmNewTurn, setConfirmNewTurn] = useState(false);
  const crew = useCrew();
  const trimmed = text.trim();
  const ready = canOperate && shell !== null;

  const onChange = (value: string) => {
    setText(value);
    if (value.trim().length === 0) {
      setTypedWhileActive(false);
      setConfirmNewTurn(false);
    } else if (active) {
      setTypedWhileActive(true);
    }
  };

  const send = async (asNewRequest = false) => {
    if (!ready || trimmed.length === 0 || shell === null) return;
    if (!active && typedWhileActive && !asNewRequest) {
      setConfirmNewTurn(true);
      return;
    }
    setSending(true);
    setProblem(null);
    const outcome = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: trimmed, attachments: [] },
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
    });
    setSending(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      setProblem(
        cause instanceof Error && /scope|permission|unauthori/i.test(cause.message)
          ? "This connection isn't allowed to send messages."
          : "That didn't send. Check your Mac is awake and try again.",
      );
      return;
    }
    setText("");
    setTypedWhileActive(false);
    setConfirmNewTurn(false);
  };

  const noteOutlivedRun = !active && typedWhileActive && trimmed.length > 0;

  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        {problem ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="warning">{problem}</Banner>
          </div>
        ) : null}
        {confirmNewTurn && noteOutlivedRun ? (
          <div className="fm-composer__confirm">
            <Banner
              tone="info"
              action={
                <span className="fm-composer__confirm-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={sending}
                    onClick={() => void send(true)}
                  >
                    Send as a new request
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmNewTurn(false);
                      setTypedWhileActive(false);
                    }}
                  >
                    Keep editing
                  </Button>
                </span>
              }
            >
              <b>{crew.builder.name} finished while you were typing.</b> This note would start a new
              request.
            </Banner>
          </div>
        ) : null}
        <MessageField
          value={text}
          onChange={onChange}
          onSend={() => void send()}
          canSend={ready && trimmed.length > 0 && !sending}
          disabled={!ready || sending}
          attach
          placeholder={
            canOperate
              ? active
                ? "Add a note while it works… (“also add a vegan option”)"
                : "Reply, change course, or ask for something else…"
              : "This connection can read but not reply"
          }
          label="Reply"
          foot={{
            left: active
              ? `Replies while ${crew.builder.name} is working get picked up at the next step.`
              : noteOutlivedRun
                ? `${crew.builder.name} has finished — Return now starts a new request.`
                : "Return to send · Shift-Return for a new line",
            right: sending ? "Sending…" : "",
          }}
        />
      </div>
    </div>
  );
}
