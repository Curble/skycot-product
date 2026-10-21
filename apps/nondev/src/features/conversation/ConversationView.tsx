import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { ChevronLeft, Clock, MessageSquareDashed, Receipt, Square } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { ProjectAvatar } from "../../app/ProjectAvatar";
import { useElapsedLabel } from "../../app/useElapsed";
import { HOME_HREF } from "../../router";
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
import { describeThreadStatus } from "./status";
import { Timeline } from "./Timeline";

/** Brings a What-changed card to the top of the stream; the card anchors itself by checkpoint id. */
function scrollToCheckpoint(checkpointId: string) {
  document
    .querySelector(`[data-checkpoint-id="${CSS.escape(checkpointId)}"]`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
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
  const status = shell ? describeThreadStatus(shell) : null;
  const active = shell ? threadRuntimeIsActive(shell.runtime) : false;
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
  const elapsed = useElapsedLabel(
    startedAt ?? shell?.latestRun?.startedAt ?? null,
    shell?.latestRun?.completedAt ?? null,
    active,
  );

  const projectName = project?.title ?? null;

  // When a run finishes with file changes, its What-changed card is the thing
  // to read next: bring it into view once, and keep a pill in the strip that
  // jumps back to it.
  const latest = projection ? (latestReviewable(projection) ?? null) : null;
  const latestId = latest?.id ?? null;
  const seenLatest = useRef<string | null>(null);
  useEffect(() => {
    if (latestId === null || latestId === seenLatest.current) return;
    seenLatest.current = latestId;
    scrollToCheckpoint(latestId);
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
          {active ? <StopButton environmentId={environmentId} threadId={threadId} /> : null}
          <PublishButton readiness={publish.readiness} onClick={() => setPublishOpen(true)} />
          {project ? <ProjectAvatar project={project} size="md" /> : null}
        </div>
      </header>

      {shell && status ? (
        <div className="fm-strip">
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
          <span>·</span>
          <span>{autonomyLabel(autonomyForRuntimeMode(shell.runtimeMode))}</span>
          {publish.status ? (
            <>
              <span>·</span>
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

function StopButton({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
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
        await interrupt({ environmentId, input: { threadId } });
        setBusy(false);
      }}
    >
      {busy ? "Stopping…" : "Stop"}
    </Button>
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
  const crew = useCrew();
  const trimmed = text.trim();
  const ready = canOperate && shell !== null;

  const send = async () => {
    if (!ready || trimmed.length === 0 || shell === null) return;
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
  };

  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        {problem ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="warning">{problem}</Banner>
          </div>
        ) : null}
        <MessageField
          value={text}
          onChange={setText}
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
              : "Return to send · Shift-Return for a new line",
            right: sending ? "Sending…" : "",
          }}
        />
      </div>
    </div>
  );
}
