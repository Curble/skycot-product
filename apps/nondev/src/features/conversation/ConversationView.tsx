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
import { ChevronLeft, Clock, MessageSquareDashed, Square } from "lucide-react";
import { type ComponentType, lazy, Suspense, useEffect, useEffectEvent, useState } from "react";

import { newMessageId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { ProjectAvatar } from "../../app/ProjectAvatar";
import { useElapsedLabel } from "../../app/useElapsed";
import { CREW_NAME } from "../../brand";
import { HOME_HREF } from "../../router";
import { projectAtomOrEmpty } from "../../state/projects";
import { canOperateEnvironmentAtom } from "../../state/session";
import {
  environmentThreads,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { Avatar } from "../../ui/Avatar";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { TypingIndicator } from "../../ui/Bubble";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { ProgressBar } from "../../ui/ProgressBar";
import { autonomyForRuntimeMode, autonomyLabel } from "../compose/autonomy";
import { MessageField } from "../compose/MessageField";
import { PublishButton, PublishSheet, PublishStatusPill, usePublishOverview } from "../publish";
import { describeThreadStatus } from "./status";
import { Timeline } from "./Timeline";

interface ReviewSectionProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

// The review feature ships separately. Resolve it through a glob so this file
// builds whether or not features/review/ReviewSection.tsx exists yet; when it
// does, it mounts between the strip and the stream.
const reviewSectionModules = import.meta.glob<{
  readonly default?: ComponentType<ReviewSectionProps>;
  readonly ReviewSection?: ComponentType<ReviewSectionProps>;
}>("../review/ReviewSection.tsx");
const loadReviewSection = Object.values(reviewSectionModules)[0];
const ReviewSection: ComponentType<ReviewSectionProps> | null = loadReviewSection
  ? lazy(async () => {
      const module = await loadReviewSection();
      const Component = module.ReviewSection ?? module.default;
      return { default: Component ?? (() => null) };
    })
  : null;

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
        <Avatar kind="crew" size="lg" />
        <div className="fm-conv-header__who">
          <span className="fm-conv-header__name">
            {CREW_NAME}
            {projectName ? ` · ${projectName}` : ""}
          </span>
          <span className="fm-conv-header__presence">
            {status ? status.presence : "Connecting…"}
            {shell?.worktreePath ? " · working in a private copy" : ""}
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
            {status.headline}
          </Pill>
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

      {ReviewSection ? (
        <Suspense fallback={null}>
          <ReviewSection environmentId={environmentId} threadId={threadId} />
        </Suspense>
      ) : null}

      {projection === null ? (
        <div className="fm-stream">
          <EmptyState title="Opening the conversation…" />
        </div>
      ) : projection.turnItems.length === 0 ? (
        <div className="fm-stream">
          <EmptyState icon={MessageSquareDashed} title="Nothing has been said yet">
            Say what you'd like done and {CREW_NAME} will show you a plan first.
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
              <TypingIndicator meta={`${CREW_NAME} is working…`} />
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
              ? `Replies while ${CREW_NAME} is working get picked up at the next step.`
              : "Return to send · Shift-Return for a new line",
            right: sending ? "Sending…" : "",
          }}
        />
      </div>
    </div>
  );
}
