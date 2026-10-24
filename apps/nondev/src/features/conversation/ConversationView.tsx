import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  MessageId,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { withExplainMarker } from "@t3tools/skycot-rules/explain";
import { withPointing } from "@t3tools/skycot-rules/preview";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  AppWindow,
  Archive,
  ChevronLeft,
  Clock,
  FolderPlus,
  Pencil,
  FolderOpen,
  Receipt,
  ShieldAlert,
  Square,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { ProjectAvatar } from "../../app/ProjectAvatar";
import { useColumns } from "../../app/useColumns";
import { useElapsedLabel } from "../../app/useElapsed";
import { filesHref, HOME_HREF, navigate } from "../../router";
import { refusedRunIdsAtom, withRefusedRun } from "../../state/conversations";
import { useConversationShell } from "../../state/oldConversations";
import { environmentProjects, projectAtomOrEmpty } from "../../state/projects";
import { canOperateEnvironmentAtom } from "../../state/session";
import { environmentThreads, threadEnvironment } from "../../state/threads";
import { CrewAvatar } from "../../themes/CrewAvatar";
import { useCrew } from "../../themes/useCrew";
import { Banner } from "../../ui/Banner";
import { Button, IconButton } from "../../ui/Button";
import { TypingIndicator } from "../../ui/Bubble";
import { EmptyState } from "../../ui/EmptyState";
import { Pill } from "../../ui/Pill";
import { ProgressBar } from "../../ui/ProgressBar";
import { Mascot } from "../brand/Mascot";
import { autonomyForRuntimeMode, autonomyLabel } from "../compose/autonomy";
import { MessageField } from "../compose/MessageField";
import { usePictures } from "../compose/usePictures";
import { requestMode, usePlanFirst } from "../compose/planFirst";
import { useEnsureInteractionMode } from "../compose/turnMode";
import { firstBlank } from "../starters/starters";
import { seedFor, StarterCards, type ComposerSeed } from "../starters/StarterCards";
import { useStartNote } from "../compose/startNotes";
import { PublishButton, PublishSheet, PublishStatusPill, usePublishOverview } from "../publish";
import { latestReviewable } from "../review";
import { useRetryMade } from "../review/useRetryMade";
import { enforcedRuntimeMode } from "../../plain/autonomy";
import { emptyConversationHint } from "../home/tip";
import { ExplainToggle, useExplainMode } from "../explain";
import { useFamily, useFamilySteps } from "../family/FamilyProvider";
import { useShield } from "../shield";
import { useBadgeWatcher } from "../badges/useBadgeWatcher";
import { GoBackSheet, type GoBackStage } from "../rewind/GoBackSheet";
import { copy as rewindCopy, type FilesChoice, type RewindTarget } from "../rewind/rewind";
import { RewindHost } from "../rewind/RewindHost";
import { stopEditing, useEditDraft } from "../rewind/store";
import { useGoBackCommand, useRewindFacts } from "../rewind/useGoBack";
import { ConversationMenuButton } from "../tidy/ConversationMenu";
import { DeleteSheet } from "../tidy/DeleteSheet";
import { RenameSheet } from "../tidy/RenameSheet";
import { useTidy } from "../tidy/useTidy";
import { PointerChips } from "../preview/PointerChips";
import {
  clearPointers,
  closePreview,
  openPreview,
  usePointers,
  usePreviewOpen,
  useSuggestedMessage,
} from "../preview/store";
import { MakeProjectSheet } from "../questions/MakeProjectSheet";
import {
  isQuestionsProject,
  JUST_ASK_COPY,
  makeProjectOffer,
  projectForConversation,
} from "../questions/questions";
import { conversationTitle, describeThreadStatus, type ConversationStatus } from "./status";
import { Timeline } from "./Timeline";
import { endedOnRefusal, waitedMillis, type AskItem } from "./WorkingCard";

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
  // A put-away conversation is not in the live list; the archive's own query has its shell.
  const { shell, archived } = useConversationShell(environmentId, threadId);
  const ownProject = useAtomValue(
    projectAtomOrEmpty({ environmentId, projectId: shell?.projectId }),
  );
  const allProjects = useAtomValue(environmentProjects.projectsAtom);
  // A question that became a project ("Make this a project") belongs with that project now.
  const project =
    shell === null ? ownProject : projectForConversation(shell, ownProject, allProjects);
  const question = isQuestionsProject(project);
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
  // The mode the engine enforces: the Family rules while the profile is on (safe steps by
  // themselves, or "Ask me first" when a parent chose it for this child).
  const family = useFamily();
  const familySteps = useFamilySteps();
  const planFirst = usePlanFirst();
  const runtimeMode =
    shell === null ? null : enforcedRuntimeMode(shell.runtimeMode, family.enabled);

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
  // A retry after a failed turn is newer than any card with files when it exists at all.
  const retryMade = useRetryMade(environmentId, threadId, projection);
  const latestId = retryMade ?? latest?.id ?? null;
  const seenLatest = useRef<string | null>(null);
  useEffect(() => {
    if (latestId === null || latestId === seenLatest.current) return;
    const firstSighting = seenLatest.current === null;
    seenLatest.current = latestId;
    if (firstSighting || readerIsNearBottom()) scrollToCheckpoint(latestId);
  }, [latestId, seenLatest]);
  const startNote = useStartNote(threadId);
  useBadgeWatcher({ threadId, shell, projection, active, retryMade });

  const rewindFacts = useRewindFacts({ environmentId, threadId, shell, projection, archived });
  const [publishOpen, setPublishOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [makeProjectOpen, setMakeProjectOpen] = useState(false);
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  const title = shell ? conversationTitle(shell) : null;
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
          <h1 className="fm-conv-header__name">{title ?? crewName}</h1>
          <span className="fm-conv-header__presence">
            {crewName}
            {projectName ? ` · ${projectName}` : ""}
            {" · "}
            {status === null
              ? "Connecting…"
              : archived
                ? "Put away in Old conversations"
                : question
                  ? `${status.presence.split(" · ")[0]} · ${JUST_ASK_COPY.presence}`
                  : shell?.worktreePath && project === ownProject
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
          {project && !archived ? <PreviewButton threadId={threadId} /> : null}
          {shell && family.profile.me.kind !== "grown-up" ? (
            <FilesButton
              onClick={() => navigate(filesHref(environmentId, shell.projectId, threadId))}
            />
          ) : null}
          {/* A question has nowhere to go live; making it a project comes first. */}
          {archived || question || family.profile.me.kind === "grown-up" ? null : (
            <PublishButton readiness={publish.readiness} onClick={() => setPublishOpen(true)} />
          )}
          {shell && canOperate ? (
            <ConversationMenuButton
              shell={shell}
              archived={archived}
              onRename={() => setRenameOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : null}
          {project ? <ProjectAvatar project={project} size="md" /> : null}
        </div>
      </header>

      {shell && status ? (
        <div className="fm-strip fm-strip--wrap">
          {archived ? (
            <Pill tone="neutral" size="sm" icon={Archive}>
              Put away
            </Pill>
          ) : null}
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
          <span>
            {familySteps?.label ??
              autonomyLabel(autonomyForRuntimeMode(runtimeMode ?? shell.runtimeMode))}
          </span>
          <span className="fm-strip__dot">·</span>
          <ExplainToggle threadId={threadId} />
          {publish.status && !question ? (
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

      {shell !== null &&
      latestId !== null &&
      canOperate &&
      makeProjectOffer({
        ownProject,
        adopted: project !== ownProject,
        worktreePath: shell.worktreePath,
        archived,
        working: active,
      }) === "offer" ? (
        <div className="fm-question-offer" role="status">
          <span className="fm-question-offer__icon" aria-hidden>
            <FolderPlus size={16} strokeWidth={1.8} />
          </span>
          <span className="fm-question-offer__text">{JUST_ASK_COPY.offer(true)}</span>
          <Button size="sm" variant="primary" onClick={() => setMakeProjectOpen(true)}>
            {JUST_ASK_COPY.makeProject}…
          </Button>
        </div>
      ) : null}

      {runtimeMode === "full-access" ? (
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
          <EmptyState art={<Mascot pose="hello" size={72} />} title="Nothing has been said yet">
            {emptyConversationHint(crewName, planFirst.on)}
          </EmptyState>
          <div className="fm-stream__starters">
            <StarterCards
              compact
              disabled={!canOperate}
              onPick={(starter) => {
                setSeed(seedFor(starter));
                if (starter.kind === "picture") {
                  document.querySelector<HTMLInputElement>(".fm-composer__file")?.click();
                }
              }}
            />
          </div>
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

      {family.profile.me.kind === "grown-up" ? (
        // A grown-up's phone reads only: no box to reply in (the engine refuses it anyway).
        <div className="fm-composer">
          <div className="fm-composer__inner">
            <p className="fm-help">Read only on this device.</p>
          </div>
        </div>
      ) : archived && shell ? (
        <PutAwayFooter shell={shell} canOperate={canOperate} />
      ) : (
        <ReplyComposer
          environmentId={environmentId}
          threadId={threadId}
          shell={shell}
          active={active}
          seed={seed}
          projection={projection}
          rewindFacts={rewindFacts}
        />
      )}

      <RewindHost
        environmentId={environmentId}
        threadId={threadId}
        shell={shell}
        facts={rewindFacts}
      />

      <RenameSheet
        shell={renameOpen ? shell : null}
        currentTitle={title ?? ""}
        archived={archived}
        onClose={() => setRenameOpen(false)}
      />
      <DeleteSheet
        shell={deleteOpen ? shell : null}
        currentTitle={title ?? ""}
        archived={archived}
        onClose={() => setDeleteOpen(false)}
      />

      <MakeProjectSheet
        shell={makeProjectOpen ? shell : null}
        title={title ?? ""}
        onClose={() => setMakeProjectOpen(false)}
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

/**
 * Where the reply field would be, for a put-away conversation: it is read-only until it
 * comes back, so a reply never lands somewhere the list does not show.
 */
function PutAwayFooter({
  shell,
  canOperate,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly canOperate: boolean;
}) {
  const tidy = useTidy();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        <Banner
          tone="info"
          action={
            canOperate ? (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await tidy.bringBack(shell);
                  setBusy(false);
                }}
              >
                {busy ? "Bringing back…" : "Bring back"}
              </Button>
            ) : null
          }
        >
          <b>This conversation is put away.</b> Nothing in it was deleted. Bring it back to reply.
        </Banner>
      </div>
    </div>
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

/** Opens the conversation's live preview beside it (a sheet on a phone), or closes it. */
function PreviewButton({ threadId }: { readonly threadId: ThreadId }) {
  const open = usePreviewOpen(threadId);
  const phone = useColumns() === 1;
  const toggle = () => (open ? closePreview() : openPreview(threadId));
  // A phone's header has room for the name or a word-button, not both.
  if (phone) {
    return <IconButton icon={AppWindow} label="Preview" aria-pressed={open} onClick={toggle} />;
  }
  return (
    <Button size="sm" icon={AppWindow} aria-pressed={open} onClick={toggle}>
      Preview
    </Button>
  );
}

/**
 * Opens this conversation's files: its private copy of the project, read-only. A phone's
 * header has no room left; there it is "See the files" in the "…" menu.
 */
function FilesButton({ onClick }: { readonly onClick: () => void }) {
  if (useColumns() === 1) return null;
  return (
    <Button size="sm" icon={FolderOpen} onClick={onClick}>
      Files
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
  seed,
  projection,
  rewindFacts,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly active: boolean;
  /** A starter card tapped in an empty conversation. */
  readonly seed: ComposerSeed | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly rewindFacts: ReturnType<typeof useRewindFacts>;
}) {
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const ensureMode = useEnsureInteractionMode();
  const planFirst = usePlanFirst();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A note typed "while it works" is a steer, not a new paid request. If the
  // run ends before Return, the first Return asks instead of sending.
  const [typedWhileActive, setTypedWhileActive] = useState(false);
  const [confirmNewTurn, setConfirmNewTurn] = useState(false);
  const pictures = usePictures();
  const pointers = usePointers(threadId);
  const family = useFamily();
  const shield = useShield();
  const [explainOn] = useExplainMode(threadId, family.enabled);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [appliedSeed, setAppliedSeed] = useState<ComposerSeed | null>(null);
  if (seed !== appliedSeed) {
    setAppliedSeed(seed);
    if (seed !== null) setText(seed.text);
  }
  useEffect(() => {
    const field = inputRef.current;
    if (appliedSeed === null || field === null) return;
    field.focus();
    const blank = firstBlank(field.value);
    if (blank !== null) field.setSelectionRange(blank.start, blank.end);
  }, [appliedSeed]);
  // "Ask Sam to fix it" and the picker's own note arrive from the preview panel.
  const suggested = useSuggestedMessage(threadId);
  const [appliedSuggestion, setAppliedSuggestion] = useState<number | null>(null);
  if (suggested !== null && suggested.nonce !== appliedSuggestion) {
    setAppliedSuggestion(suggested.nonce);
    setText((current) =>
      suggested.mode === "append" && current.trim().length > 0
        ? `${current.trimEnd()} ${suggested.text}`
        : suggested.text,
    );
  }
  const suggestedMode = suggested?.mode ?? "replace";
  useEffect(() => {
    const field = inputRef.current;
    if (appliedSuggestion === null || field === null) return;
    field.focus();
    // A written-for-you message is read from its first line; a picker note is typed after.
    const at = suggestedMode === "replace" ? 0 : field.value.length;
    field.setSelectionRange(at, at);
    if (suggestedMode === "replace") field.scrollTop = 0;
  }, [appliedSuggestion, suggestedMode]);
  // "Edit" on an earlier message puts its words here; sending then goes back to there.
  const editing = useEditDraft(threadId);
  const goBack = useGoBackCommand({ environmentId, threadId, projection });
  const [beforeEdit, setBeforeEdit] = useState<string | null>(null);
  const [appliedEdit, setAppliedEdit] = useState<number | null>(null);
  if (editing !== null && editing.nonce !== appliedEdit) {
    setAppliedEdit(editing.nonce);
    if (beforeEdit === null) setBeforeEdit(text);
    setText(editing.text);
    setProblem(null);
  }
  if (editing === null && appliedEdit !== null) {
    setAppliedEdit(null);
    setBeforeEdit(null);
  }
  useEffect(() => {
    const field = inputRef.current;
    if (appliedEdit === null || field === null) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [appliedEdit]);
  const [goBackOpen, setGoBackOpen] = useState<{
    readonly target: RewindTarget;
    readonly choice: FilesChoice;
    readonly message: { readonly text: string; readonly messageId: MessageId };
  } | null>(null);
  const [goBackStage, setGoBackStage] = useState<GoBackStage>("idle");
  const [goBackProblem, setGoBackProblem] = useState<string | null>(null);
  const cancelEditing = () => {
    stopEditing(threadId);
    setText(beforeEdit ?? "");
  };
  const crew = useCrew();
  const trimmed = text.trim();
  const ready = canOperate && shell !== null;
  const hasContent = trimmed.length > 0 || pointers.length > 0;

  const onChange = (value: string) => {
    setText(value);
    if (value.trim().length === 0) {
      setTypedWhileActive(false);
      setConfirmNewTurn(false);
    } else if (active) {
      setTypedWhileActive(true);
    }
  };

  /** Sends one checked message as a turn: plan first decides how a new request runs. */
  const deliver = async (
    message: { readonly text: string; readonly messageId: MessageId },
    asNote: boolean,
  ): Promise<boolean> => {
    if (shell === null) return false;
    setSending(true);
    setProblem(null);
    // A note typed while it works joins that turn; anything else is a new request.
    const interactionMode = asNote ? shell.interactionMode : requestMode(planFirst);
    const modeProblem = await ensureMode({
      environmentId,
      threadId,
      current: shell.interactionMode,
      wanted: interactionMode,
    });
    const outcome =
      modeProblem !== null
        ? null
        : await startTurn({
            environmentId,
            input: {
              threadId,
              message: {
                messageId: message.messageId,
                role: "user",
                text: withExplainMarker(message.text, explainOn, family.enabled),
                attachments: pictures.uploads(),
              },
              modelSelection: shell.modelSelection,
              runtimeMode: shell.runtimeMode,
              interactionMode,
            },
          });
    setSending(false);
    if (outcome === null || outcome._tag === "Failure") {
      const cause = outcome === null ? modeProblem : squashAtomCommandFailure(outcome);
      setProblem(
        cause instanceof Error && /scope|permission|unauthori/i.test(cause.message)
          ? "This connection isn't allowed to send messages."
          : "That didn't send. Check your Mac is awake and try again.",
      );
      return false;
    }
    setText("");
    pictures.clear();
    clearPointers(threadId);
    setTypedWhileActive(false);
    setConfirmNewTurn(false);
    return true;
  };

  const send = async (asNewRequest = false) => {
    if (!ready || !hasContent || shell === null) return;
    if (!active && typedWhileActive && !asNewRequest && editing === null) {
      setConfirmNewTurn(true);
      return;
    }
    // What was pointed at in the preview travels as words in the message, so the shield reads
    // it too. Family profile: a full name, school or address waits for the child's pick.
    const outgoing = withPointing(
      trimmed,
      pointers.map((draft) => draft.pointer),
    );
    const cleared = await shield.clear(outgoing, pictures.pictures.length);
    if (cleared.kind === "edit") {
      if (cleared.dropPictures) pictures.clear();
      return;
    }
    if (editing !== null) {
      // Checked again here: the conversation may have moved since Edit was pressed.
      const check = rewindFacts.check(editing.itemId);
      if (check === null || !check.ok) {
        const words = rewindCopy.blocked(check?.block ?? "gone", crew.builder.name);
        setProblem(`${words.title}. ${words.body}`);
        return;
      }
      setGoBackProblem(null);
      setGoBackStage("idle");
      setGoBackOpen({
        target: check.target,
        choice: rewindFacts.choiceFor(check.target),
        message: { text: cleared.text, messageId: cleared.messageId },
      });
      return;
    }
    await deliver(cleared, active);
  };

  const confirmGoBack = async (restoreFiles: boolean) => {
    if (goBackOpen === null) return;
    setGoBackProblem(null);
    setGoBackStage("going-back");
    const problemGoingBack = await goBack(goBackOpen.target, restoreFiles);
    if (problemGoingBack !== null) {
      setGoBackStage("idle");
      setGoBackProblem(problemGoingBack);
      return;
    }
    setGoBackStage("sending");
    stopEditing(threadId);
    const sent = await deliver(goBackOpen.message, false);
    setGoBackStage("idle");
    setGoBackOpen(null);
    if (!sent) {
      setProblem(
        "Went back, but your changed message didn't send. It's still in the box: press Return to try again.",
      );
    }
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
        {pictures.problem ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="warning">{pictures.problem}</Banner>
          </div>
        ) : null}
        {editing !== null ? (
          <div className="fm-composer__editing">
            <Banner
              tone="info"
              action={
                <Button size="sm" onClick={cancelEditing} disabled={sending}>
                  Cancel
                </Button>
              }
            >
              <span className="fm-composer__editing-what">
                <Pencil size={13} strokeWidth={2} aria-hidden />
                <b>Changing your earlier message.</b>
              </span>{" "}
              Sending it goes back to there and replaces what came after.
              {editing.pictures > 0
                ? ` Its ${editing.pictures === 1 ? "picture doesn't" : "pictures don't"} come back: add ${editing.pictures === 1 ? "it" : "them"} again with + if you still want ${editing.pictures === 1 ? "it" : "them"}.`
                : ""}
              {editing.pointedAt > 0
                ? " What you pointed at doesn't come back: point at it again if you need to."
                : ""}
            </Banner>
          </div>
        ) : null}
        <GoBackSheet
          key={goBackOpen === null ? "closed" : goBackOpen.message.messageId}
          open={goBackOpen !== null}
          target={goBackOpen?.target ?? null}
          choice={goBackOpen?.choice ?? { kind: "nothing" }}
          planFirst={planFirst.on}
          stage={goBackStage}
          problem={goBackProblem}
          onCancel={() => setGoBackOpen(null)}
          onConfirm={(restoreFiles) => void confirmGoBack(restoreFiles)}
        />
        {shield.card}
        <PointerChips threadId={threadId} pointers={pointers} disabled={sending} />
        <MessageField
          inputRef={inputRef}
          value={text}
          onChange={onChange}
          onSend={() => void send()}
          canSend={ready && hasContent && !sending}
          disabled={!ready || sending}
          pictures={pictures.pictures}
          onAddPictures={pictures.add}
          onRemovePicture={pictures.remove}
          placeholder={
            canOperate
              ? editing !== null
                ? "Change your message…"
                : active
                  ? "Add a note while it works… (“also add a vegan option”)"
                  : "Reply, change course, or ask for something else…"
              : "This connection can read but not reply"
          }
          label={editing !== null ? "Your changed message" : "Reply"}
          foot={{
            left:
              editing !== null
                ? "Return to go back and send · Shift-Return for a new line"
                : active
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
