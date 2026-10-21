// The Publish ceremony as one macOS sheet with stepped groups:
//   1 Quick safety check → 2 How would you like to publish? → 3 Confirm → 4 Result
// With the Family profile on, a "Parent code" step sits before Confirm.
// Nothing is pre-selected, nothing leaves the Mac before the Confirm button, and
// the default branch is never pushed from here (plain/git.ts guarantees it).
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  GitRunStackedActionResult,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  PullRequestRef,
  PullRequestReviewerCandidate,
  ThreadId,
} from "@t3tools/contracts";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Send,
  Undo2,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { newMessageId, randomUUID } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { CREW_NAME } from "../../brand";
import { copy, describeStackedResult } from "../../plain";
import { ConfettiBurst } from "../../themes/Confetti";
import { CrewAvatar } from "../../themes/CrewAvatar";
import { possessive, useCrew } from "../../themes/useCrew";
import { threadEnvironment } from "../../state/threads";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Pill } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { StepBadge, type StepBadgeState } from "../../ui/StepBadge";
import {
  HONESTY_NOTE,
  SETTINGS_HREF,
  buildSafetyCheck,
  describeFailure,
  resolveLiveChoice,
  resolveReviewChoice,
  reviewerDisplayName,
  reviewerSummaryText,
  type LiveChoice,
  type ReviewChoice,
  type SafetyLine,
} from "./model";
import {
  pullRequestReviewerCandidates,
  requestPullRequestReviewers,
  runPullRequestAction,
  vcsActionManager,
  vcsEnvironment,
} from "./state";
import { familyCopy } from "../family/copy";
import { useFamily } from "../family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { rememberKeptVersion } from "../review/keptVersions";
import { latestReviewable } from "../review/turnReview";
import { rememberUpload } from "./uploads";
import { usePublishData } from "./usePublishData";

type Phase = "choose" | "code" | "confirm" | "done";
type Choice = "review" | "live";

type Outcome =
  | {
      readonly kind: "review";
      readonly sentence: string;
      readonly url: string | null;
      readonly number: number | null;
      readonly branch: string | null;
      readonly openedReview: boolean;
    }
  | { readonly kind: "keep"; readonly sentence: string }
  | { readonly kind: "live"; readonly sentence: string; readonly url: string | null }
  | { readonly kind: "script"; readonly sentence: string };

interface Failure {
  readonly headline: string;
  readonly hint: string | null;
  readonly detail: string;
}

export function PublishSheet({
  open,
  onClose,
  environmentId,
  threadId,
  shell,
  project,
  projection,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
}) {
  if (!open) return null;
  return (
    <PublishSheetBody
      onClose={onClose}
      environmentId={environmentId}
      threadId={threadId}
      shell={shell}
      project={project}
      projection={projection}
    />
  );
}

// Mounted only while open so every open starts from step 1 with fresh state.
function PublishSheetBody({
  onClose,
  environmentId,
  threadId,
  shell,
  project,
  projection,
}: {
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
}) {
  const data = usePublishData({
    environmentId,
    threadId,
    shell,
    project,
    projection,
    wantDetail: true,
    wantChanges: true,
  });
  const projectName = project?.title ?? null;
  const crew = useCrew();
  const family = useFamily();
  // Both ways out (review and live) wait for the code while the Family profile is on.
  const needsCode = family.isLocked("publish");

  const [phase, setPhase] = useState<Phase>("choose");
  const codeEntry = useParentCodeEntry(() => setPhase("confirm"));
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);

  // The choice cards unmount when a step changes, which would drop focus to
  // the page body (and Escape with it); focus follows to the current step's
  // heading instead — a heading, so nothing is pre-selected.
  const stepHeads = useRef<Partial<Record<Phase | "check", HTMLElement | null>>>({});
  useEffect(() => {
    // The code step focuses its field instead (autoFocus): a heading would hide the keyboard on a phone.
    if (phase === "code") return;
    const head = stepHeads.current[phase];
    if (head && !head.contains(document.activeElement)) head.focus({ preventScroll: false });
  }, [phase]);

  const scope = { environmentId, cwd: data.cwd };
  const runStacked = useAtomCommand(vcsActionManager.runStackedAction(scope), {
    reportFailure: false,
  });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const runAction = useAtomCommand(runPullRequestAction, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const actionState = useAtomValue(vcsActionManager.stateAtom(scope));

  // Remotes and branches can change outside the app (a developer adds GitHub
  // in Terminal); the cached status would otherwise offer yesterday's choices.
  const refreshOnOpen = useEffectEvent(() => {
    if (data.cwd === null) return;
    void refreshStatus({ environmentId, input: { cwd: data.cwd } });
  });
  useEffect(() => {
    refreshOnOpen();
  }, []);

  const safety = buildSafetyCheck({
    changes: {
      // After an upload, count what this upload changes on the online copy.
      conversation: data.sinceUpload ?? data.changes,
      outsideConversation: data.outsideConversation,
      pending: data.changesPending,
    },
    checkRuns: data.checkRuns,
    operationsKnown: data.operationsKnown,
    reversedKept: data.reversedKept,
  });

  const review: ReviewChoice = resolveReviewChoice({
    vcs: data.vcs,
    cwd: data.cwd ?? "",
    link: data.link,
    connection: data.connection,
  });
  const live: LiveChoice = resolveLiveChoice({
    link: data.link,
    detail: data.detail,
    connection: data.connection,
    scripts: project?.scripts ?? [],
    canWrite: data.canWrite,
  });

  const choose = (next: Choice) => {
    setChoice(next);
    setFailure(null);
    setPhase(needsCode ? "code" : "confirm");
  };

  const fail = (error: unknown) => {
    setFailure(describeFailure(error, { remote: data.remoteKind }));
  };

  const finishStacked = (result: GitRunStackedActionResult, opensReview: boolean) => {
    const sentence = describeStackedResult(result);
    // A commit made here is a kept version too: the What-changed card and the
    // rail learn about it the same way as the card's own Keep button.
    if (result.commit.status === "created" && result.commit.commitSha) {
      const checkpoint = projection ? latestReviewable(projection) : undefined;
      rememberKeptVersion(threadId, {
        sha: result.commit.commitSha,
        subject: (result.commit.subject ?? data.changes?.summary ?? "Kept version").replace(
          /\.$/,
          "",
        ),
        at: new Date().toISOString(),
        ...(data.changes ? { fileCount: data.changes.counts.files } : {}),
        ...(checkpoint ? { checkpointId: checkpoint.id } : {}),
      });
    }
    if (result.push.status === "pushed") {
      rememberUpload(threadId, {
        at: new Date().toISOString(),
        branch: result.push.branch ?? result.branch.name ?? null,
      });
    }
    if (result.action === "commit") {
      setOutcome({ kind: "keep", sentence });
    } else {
      setOutcome({
        kind: "review",
        sentence,
        url: result.pr.url ?? null,
        number: result.pr.number ?? null,
        branch: result.push.branch ?? result.branch.name ?? null,
        openedReview: opensReview && result.pr.status !== "skipped_not_requested",
      });
    }
    setPhase("done");
  };

  const confirm = async () => {
    if (busy || choice === null || !data.canWrite || phase !== "confirm") return;
    setBusy(true);
    setFailure(null);
    try {
      if (choice === "review") {
        if (review.kind === "blocked") return;
        if (data.cwd === null) return;
        const result = await runStacked({
          actionId: randomUUID(),
          action: review.plan.input.action,
          ...(review.plan.input.featureBranch ? { featureBranch: true } : {}),
          // Without a message the engine asks the assistant to write one — a
          // paid call that can fail. The request plus the plain summary reads
          // like the card's own Keep.
          commitMessage: commitMessageFor(projection, data.changes?.summary ?? null),
          threadId,
          ...(shell ? { projectId: shell.projectId } : {}),
        });
        if (result._tag === "Failure") {
          fail(squashAtomCommandFailure(result));
          return;
        }
        void refreshStatus({ environmentId, input: { cwd: data.cwd } });
        finishStacked(result.value, review.kind === "review" && review.opensReview);
        return;
      }
      if (live.kind === "merge") {
        if (data.linkRef === null) return;
        const result = await runAction({
          environmentId,
          input: { ...data.linkRef, action: "merge", mergeMethod: live.plan.method },
        });
        if (result._tag === "Failure") {
          fail(squashAtomCommandFailure(result));
          return;
        }
        setOutcome({
          kind: "live",
          sentence: `Review #${live.link.number} is now part of ${live.link.snapshot?.baseBranch ?? "the live version"}.`,
          url: live.link.url,
        });
        setPhase("done");
        return;
      }
      if (live.kind === "script" && shell) {
        // Going live always asks: the turn runs in "Ask me first" whatever the
        // conversation's mode, and the message names the script, not its
        // command, so the assistant runs what Settings configured.
        const result = await startTurn({
          environmentId,
          input: {
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: `Put it live by running this project's “${live.script.name}” script exactly as it is set up in the project's scripts, and tell me when the site is live.`,
              attachments: [],
            },
            modelSelection: shell.modelSelection,
            runtimeMode: "approval-required",
            interactionMode: shell.interactionMode,
          },
        });
        if (result._tag === "Failure") {
          fail(squashAtomCommandFailure(result));
          return;
        }
        setOutcome({
          kind: "script",
          sentence: `${CREW_NAME} is running “${live.script.name}”. Watch this conversation; it will say when it's done.`,
        });
        setPhase("done");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmingLive = phase === "confirm" && choice === "live";
  const title = projectName ? `Publish · ${projectName}` : "Publish";
  const confirmNumber = needsCode ? 4 : 3;

  const actions =
    phase === "choose" ? (
      <Button onClick={onClose}>Not now</Button>
    ) : phase === "code" ? (
      <>
        <Button onClick={() => setPhase("choose")} disabled={codeEntry.busy}>
          Not yet
        </Button>
        <Button
          variant="primary"
          disabled={!codeEntry.canSubmit}
          onClick={() => void codeEntry.submit()}
        >
          {codeEntry.busy ? "Checking…" : "Continue"}
        </Button>
      </>
    ) : phase === "confirm" ? (
      <>
        <Button onClick={() => setPhase("choose")} disabled={busy}>
          Not yet
        </Button>
        <Button
          variant={choice === "live" ? "destructive" : "primary"}
          filled
          disabled={
            busy ||
            !data.canWrite ||
            (choice === "review" ? review.kind === "blocked" : live.kind === "blocked")
          }
          onClick={() => void confirm()}
        >
          {busy
            ? "Working…"
            : choice === "live"
              ? copy.buttons.putItLive
              : review.kind === "keep"
                ? copy.buttons.keepThisVersion
                : review.kind === "review"
                  ? review.label
                  : copy.buttons.sendForReview}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    );

  return (
    <Sheet
      open
      onClose={busy ? () => {} : onClose}
      wide
      icon={confirmingLive ? Globe : phase === "code" ? KeyRound : Upload}
      iconTone={confirmingLive ? "red" : phase === "code" ? "grey" : "blue"}
      title={title}
      description="Nothing leaves your Mac until you press a button below. Each step is one plain question."
      initialFocus="body"
      dismissOnBackdrop={!busy}
      // Every confirm is a plain, sober surface: what goes online is never a sketch.
      sober={phase === "confirm" || phase === "code"}
      actions={actions}
      note={phase === "confirm" && choice === "live" ? copy.git.neverPushLive : undefined}
    >
      <div className="fm-pub">
        <StepGroup
          number={1}
          title={
            crew.named ? (
              <span className="fm-crew-kicker">
                <CrewAvatar role="checker" size="sm" />
                {possessive(crew.checker.name)} quick check
              </span>
            ) : (
              "Quick safety check"
            )
          }
          state="done"
          badge={safetyBadge(safety.lines)}
          trailing={safety.summary}
          expanded={phase === "choose"}
          headRef={(node) => {
            stepHeads.current.check = node;
          }}
        >
          <ul className="fm-pub-rows" aria-label="Safety check results">
            {safety.lines.map((line) => (
              <SafetyRow key={line.text} line={line} />
            ))}
          </ul>
          <p className="fm-pub-help fm-tip">
            {crew.named
              ? `${crew.checker.name} looks for the things that bite people before they go live, and can still miss some. For anything that matters a lot, ask a person to review first.`
              : HONESTY_NOTE}
          </p>
        </StepGroup>

        <StepGroup
          number={2}
          title="How would you like to publish?"
          state={phase === "choose" ? "now" : "done"}
          trailing={
            phase === "choose"
              ? "Nothing is pre-selected"
              : choice === "live"
                ? live.label
                : review.label
          }
          expanded={phase === "choose"}
          onChange={
            (phase === "confirm" || phase === "code") && !busy
              ? () => setPhase("choose")
              : undefined
          }
          headRef={(node) => {
            stepHeads.current.choose = node;
          }}
        >
          <div className="fm-pub-choices" role="group" aria-label="Ways to publish">
            <ChoiceCard
              icon={review.kind === "keep" ? Check : UserRound}
              title={review.label}
              recommended={review.kind === "review" && review.opensReview}
              explainer={
                review.kind === "blocked" ? (
                  review.reason
                ) : (
                  <>
                    {review.explainer}
                    {data.lastUpload && review.kind === "review"
                      ? ` Last uploaded ${formatUploadTime(data.lastUpload.at)}${data.uploadCurrent ? " — nothing new since." : "."}`
                      : ""}
                    {review.kind === "keep" ? (
                      <>
                        {" "}
                        <a href={SETTINGS_HREF} className="fm-pub-link" onClick={onClose}>
                          Connect GitHub in Settings
                        </a>
                      </>
                    ) : null}
                    {review.kind === "review" && review.guard ? (
                      <span className="fm-pub-guard">{review.guard}</span>
                    ) : null}
                  </>
                )
              }
              advanced={review.advanced}
              disabled={review.kind === "blocked" || !data.canWrite}
              onClick={() => choose("review")}
            />
            <ChoiceCard
              icon={Globe}
              title={live.label}
              explainer={live.kind === "blocked" ? live.reason : live.explainer}
              advanced={live.advanced}
              disabled={live.kind === "blocked" || (live.kind === "merge" && !data.canWrite)}
              onClick={() => choose("live")}
            />
          </div>
          {!data.canWrite ? (
            <p className="fm-pub-help">This connection can look but not publish.</p>
          ) : null}
        </StepGroup>

        {needsCode ? (
          <StepGroup
            number={3}
            title="Parent code"
            state={phase === "choose" ? "todo" : phase === "code" ? "now" : "done"}
            trailing={
              phase === "code"
                ? familyCopy.title
                : phase === "choose"
                  ? undefined
                  : "Confirmed by a parent"
            }
            expanded={phase === "code"}
            headRef={(node) => {
              stepHeads.current.code = node;
            }}
          >
            <p className="fm-pub-help">
              {choice === "live"
                ? "Putting it live"
                : review.kind === "keep"
                  ? "Keeping a version"
                  : review.kind === "review" && review.opensReview
                    ? "Sending for review"
                    : "Uploading a draft line"}{" "}
              needs a parent&apos;s OK while the {familyCopy.title} is on.
            </p>
            <ParentCodeEntry entry={codeEntry} autoFocus />
          </StepGroup>
        ) : null}

        <StepGroup
          number={confirmNumber}
          title={
            phase === "choose" || phase === "code"
              ? "Confirm"
              : choice === "live"
                ? live.kind === "script"
                  ? `Ask ${CREW_NAME} to put it live?`
                  : `Put it live${projectName ? ` on ${projectName}` : ""}?`
                : review.kind === "keep"
                  ? "Keep this version?"
                  : review.kind === "review" && !review.opensReview
                    ? "Upload a draft line?"
                    : "Send for review?"
          }
          state={
            phase === "choose" || phase === "code" ? "todo" : phase === "confirm" ? "now" : "done"
          }
          danger={choice === "live" && (phase === "confirm" || phase === "done")}
          trailing={
            phase === "confirm" && choice === "live" ? (
              <span className="fm-pub-danger-text">Leaves your Mac · asks every time</span>
            ) : phase === "done" ? (
              "Confirmed"
            ) : undefined
          }
          expanded={phase === "confirm"}
          headRef={(node) => {
            stepHeads.current.confirm = node;
          }}
        >
          <ConfirmBody choice={choice} review={review} live={live} data={data} />
          {busy ? (
            <p className="fm-pub-progress" role="status">
              <Pill tone="working" size="sm">
                Working…
              </Pill>
              {actionState.currentPhaseLabel ?? actionState.currentLabel ?? ""}
            </p>
          ) : null}
          {failure ? <FailureNotice failure={failure} onRetry={() => void confirm()} /> : null}
        </StepGroup>

        <StepGroup
          number={confirmNumber + 1}
          title={
            outcome === null ? (
              "Result"
            ) : outcome.kind === "live" ? (
              <span className="fm-marker-underline fm-marker-underline--green">
                {crew.playful ? "It's live! 🎉" : "It's live."}
              </span>
            ) : outcome.kind === "keep" ? (
              "Kept on this Mac."
            ) : outcome.kind === "script" ? (
              `${CREW_NAME} is on it.`
            ) : reviewerName ? (
              `Sent to ${reviewerName} for review.`
            ) : outcome.openedReview ? (
              "Sent for review."
            ) : (
              "Uploaded the draft line."
            )
          }
          state={phase === "done" ? "done" : "todo"}
          success={phase === "done"}
          expanded={phase === "done"}
          headRef={(node) => {
            stepHeads.current.done = node;
          }}
        >
          {outcome?.kind === "live" ? <ConfettiBurst /> : null}
          {outcome ? (
            <ResultBody
              outcome={outcome}
              environmentId={environmentId}
              data={data}
              projectName={projectName}
              reviewerName={reviewerName}
              onReviewerRequested={setReviewerName}
              onFailure={fail}
            />
          ) : null}
          {failure && phase === "done" ? (
            <FailureNotice failure={failure} onRetry={undefined} />
          ) : null}
        </StepGroup>
      </div>
    </Sheet>
  );
}

/** A tick would claim the check passed; the badge says what the rows say. */
function safetyBadge(lines: ReadonlyArray<SafetyLine>): StepBadgeState {
  if (lines.some((line) => line.state === "fail")) return "fail";
  if (lines.some((line) => line.state === "warn")) return "warn";
  return lines.length > 0 && lines.every((line) => line.state === "ok") ? "done" : "number";
}

/** First line of the latest request, plain summary underneath; git shows the first line in every log. */
function commitMessageFor(
  projection: OrchestrationV2ThreadProjection | null,
  summary: string | null,
): string {
  // The latest real request, not a note added while the Crew worked.
  const request = projection?.turnItems
    .findLast(
      (item): item is Extract<OrchestrationV2TurnItem, { type: "user_message" }> =>
        item.type === "user_message" &&
        item.inputIntent !== "steer" &&
        item.inputIntent !== "promoted_queued_to_steer" &&
        item.inputIntent !== "queued_turn",
    )
    ?.text.trim()
    .split(/\r?\n/)[0]
    ?.trim();
  const source = (
    request && request.length > 0 ? request : (summary ?? "Changes from SKYCOT")
  ).replace(/\.$/, "");
  const subject = source.length > 72 ? `${source.slice(0, 71).trimEnd()}…` : source;
  return summary ? `${subject}\n\n${summary}` : subject;
}

function formatUploadTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? `at ${time}`
    : `on ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${time}`;
}

function StepGroup({
  number,
  title,
  state,
  badge,
  trailing,
  expanded,
  danger = false,
  success = false,
  onChange,
  headRef,
  children,
}: {
  readonly number: number;
  readonly title: ReactNode;
  readonly state: "done" | "now" | "todo";
  /** Overrides the badge drawn for a finished step whose outcome was not a plain success. */
  readonly badge?: StepBadgeState;
  readonly trailing?: ReactNode;
  readonly expanded: boolean;
  readonly danger?: boolean;
  readonly success?: boolean;
  readonly onChange?: (() => void) | undefined;
  readonly headRef?: (node: HTMLElement | null) => void;
  readonly children?: ReactNode;
}) {
  const classes = [
    "fm-pub-group",
    `fm-pub-group--${state}`,
    danger && state !== "todo" ? "fm-pub-group--danger" : "",
    success ? "fm-pub-group--success" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={classes} aria-label={`Step ${number}`}>
      <header className="fm-pub-group__head" tabIndex={-1} ref={headRef}>
        <StepBadge
          state={state === "done" && badge ? badge : state}
          label={state === "done" ? "Done" : state === "now" ? "Current step" : "Upcoming step"}
        >
          {number}
        </StepBadge>
        <b className="fm-pub-group__title">{title}</b>
        {trailing ? <span className="fm-pub-group__trailing">{trailing}</span> : null}
        {onChange ? (
          <Button variant="plain" size="sm" onClick={onChange}>
            Change
          </Button>
        ) : null}
      </header>
      {expanded ? <div className="fm-pub-group__body">{children}</div> : null}
    </section>
  );
}

const SAFETY_BADGE: Record<SafetyLine["state"], StepBadgeState> = {
  ok: "ok",
  warn: "warn",
  fail: "fail",
  unknown: "todo",
};

function SafetyRow({ line }: { readonly line: SafetyLine }) {
  return (
    <li className={`fm-pub-row fm-pub-row--${line.state}`}>
      <StepBadge
        state={SAFETY_BADGE[line.state]}
        label={
          line.state === "ok"
            ? "Fine"
            : line.state === "warn"
              ? "Worth a look"
              : line.state === "fail"
                ? "Problem"
                : "Not checked"
        }
      >
        ?
      </StepBadge>
      <span className="fm-pub-row__text">
        {line.text}
        {line.detail ? (
          <details className="fm-pub-details">
            <summary>{copy.buttons.showDetails}</summary>
            <pre>{line.detail}</pre>
          </details>
        ) : null}
      </span>
    </li>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  explainer,
  advanced,
  recommended = false,
  disabled,
  onClick,
}: {
  readonly icon: typeof Globe;
  readonly title: string;
  readonly explainer: ReactNode;
  readonly advanced: string;
  readonly recommended?: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="fm-pub-choice"
      disabled={disabled}
      onClick={onClick}
      aria-disabled={disabled}
    >
      <span className="fm-pub-choice__icon" aria-hidden>
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span className="fm-pub-choice__body">
        <span className="fm-pub-choice__title">
          {title}
          {recommended ? <span className="fm-pub-tag">Recommended</span> : null}
        </span>
        <span className="fm-pub-choice__text">{explainer}</span>
        <span className="fm-pub-choice__advanced">{advanced}</span>
      </span>
      <span className="fm-pub-choice__radio" aria-hidden />
    </button>
  );
}

function ConfirmBody({
  choice,
  review,
  live,
  data,
}: {
  readonly choice: Choice | null;
  readonly review: ReviewChoice;
  readonly live: LiveChoice;
  readonly data: ReturnType<typeof usePublishData>;
}) {
  if (choice === null) return null;
  // What goes out is the working tree, which may be less than the conversation
  // changed when part of it was kept earlier; say the smaller, truer number.
  // Otherwise the sheet counts the whole conversation, and says so when that
  // differs from the latest card's single turn.
  const pendingFiles = data.vcs?.workingTree.files.length ?? 0;
  const wholeConversation = data.turnsWithChanges > 1 && data.operationsKnown;
  const changed =
    choice === "review" && data.sinceUpload !== null
      ? `${data.sinceUpload.summary.replace(/\.$/, "")} since the last upload${data.reversesOnline ? " — this reverses what's online" : ""}.`
      : data.vcs?.hasWorkingTreeChanges && data.changes && pendingFiles < data.changes.counts.files
        ? `${pendingFiles} ${pendingFiles === 1 ? "file" : "files"} not yet kept (the rest of this conversation's changes were kept earlier).`
        : data.changes
          ? `${data.changes.summary}${wholeConversation ? " That counts every change in this conversation, so the numbers can differ from the latest What-changed card, which shows one step." : ""}`
          : "The files from this conversation.";
  const reversal =
    data.reversedKept.length > 0 ? (
      <p className="fm-pub-reversal">
        This includes undoing{" "}
        {data.reversedKept
          .map((kept) =>
            kept.number === null
              ? `“${kept.subject}”`
              : `Version ${kept.number} (“${kept.subject}”)`,
          )
          .join(" and ")}
        , which {data.reversedKept.length === 1 ? "was" : "were"} already kept as a Git commit. The
        online copy will receive the reversal, not a deletion of history.
      </p>
    ) : null;
  if (choice === "live") {
    if (live.kind === "blocked") return <p className="fm-pub-help">{live.reason}</p>;
    const rows: Array<[string, string]> =
      live.kind === "merge"
        ? [
            [
              "What will happen",
              `${changed} ${changed.endsWith(".") ? "" : "."} These become part of the live version (${live.link.snapshot?.baseBranch ?? "main"}) that everyone sees.`,
            ],
            [
              "What won't",
              `${copy.changes.untouched} Nothing in a database or account changes — only the project's files.`,
            ],
            [
              "If it looks wrong",
              live.canTakeBack
                ? "“Take it back” opens a reversal so the live version returns to how it was."
                : "There's no automatic reversal for this project. You'd ask for a fix as a new change.",
            ],
          ]
        : [
            [
              "What will happen",
              `${CREW_NAME} runs your “${live.script.name}” script in this conversation, asking before each step, and reports back.`,
            ],
            [
              "What won't",
              "Nothing changes until that script runs, and your usual approval setting applies before anything leaves your Mac.",
            ],
            [
              "If it looks wrong",
              "Ask for it to be undone in the same conversation; earlier versions stay in the Versions list.",
            ],
          ];
    return (
      <>
        <KeyValues rows={rows} />
        <p className="fm-pub-advanced">{live.advanced}</p>
      </>
    );
  }
  if (review.kind === "blocked") return <p className="fm-pub-help">{review.reason}</p>;
  const rows: Array<[string, string]> =
    review.kind === "keep"
      ? [
          [
            "What will happen",
            `${changed}${changed.endsWith(".") ? "" : "."} Saved as a named version in this project's history, on this Mac.`,
          ],
          ["What won't", "Nothing goes online and nothing goes live."],
          ["If it looks wrong", "Restore any earlier version from the Versions list."],
        ]
      : [
          [
            "What will happen",
            `${changed}${changed.endsWith(".") ? "" : "."} ${review.opensReview ? "They're uploaded to a separate draft line and a review request is opened." : "They're uploaded to a separate draft line on the online copy."}`,
          ],
          [
            "What won't",
            `${copy.git.neverPushLive} Customers see nothing until a reviewer combines it.`,
          ],
          [
            "If it looks wrong",
            "Close the review, or keep changing things — the draft line is yours.",
          ],
        ];
  return (
    <>
      <KeyValues rows={rows} />
      {reversal}
      {review.kind === "review" && review.guard ? (
        <Banner tone="info">{review.guard}</Banner>
      ) : null}
      <p className="fm-pub-advanced">{review.advanced}</p>
    </>
  );
}

function KeyValues({ rows }: { readonly rows: ReadonlyArray<[string, string]> }) {
  return (
    <dl className="fm-pub-kv">
      {rows.map(([key, value]) => (
        <div key={key} className="fm-pub-kv__row">
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FailureNotice({
  failure,
  onRetry,
}: {
  readonly failure: Failure;
  readonly onRetry: (() => void) | undefined;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="fm-pub-failure">
      <Banner
        tone="warning"
        action={
          <span className="fm-pub-failure__actions">
            {onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
            <Button size="sm" variant="plain" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? "Hide details" : copy.buttons.showDetails}
            </Button>
          </span>
        }
      >
        <b>{failure.headline}</b>
        {failure.hint ? ` ${failure.hint}` : ""}
      </Banner>
      {showDetails ? <pre className="fm-pub-failure__detail">{failure.detail}</pre> : null}
    </div>
  );
}

function ResultBody({
  outcome,
  environmentId,
  data,
  projectName,
  reviewerName,
  onReviewerRequested,
  onFailure,
}: {
  readonly outcome: Outcome;
  readonly environmentId: EnvironmentId;
  readonly data: ReturnType<typeof usePublishData>;
  readonly projectName: string | null;
  readonly reviewerName: string | null;
  readonly onReviewerRequested: (name: string) => void;
  readonly onFailure: (error: unknown) => void;
}) {
  const [copied, setCopied] = useState<"link" | "summary" | null>(null);
  const url =
    outcome.kind === "review" ? outcome.url : outcome.kind === "live" ? outcome.url : null;
  const copyText = async (text: string, what: "link" | "summary") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  const summary = reviewerSummaryText({ projectName, changes: data.changes, url });

  // The server links a review it creates to this thread (we pass threadId), so
  // the shell's link is the reference for the reviewer picker once it arrives.
  const reviewRef = data.linkRef;

  return (
    <div className="fm-pub-result">
      <p className="fm-pub-result__sentence">{outcome.sentence}</p>
      {outcome.kind === "review" && !outcome.openedReview && data.connection !== "connected" ? (
        <p className="fm-pub-help">
          GitHub isn't connected on this Mac, so no review request was opened.{" "}
          <a href={SETTINGS_HREF} className="fm-pub-link">
            Connect GitHub in Settings
          </a>
          {outcome.branch ? <> · Advanced: branch {outcome.branch}</> : null}
        </p>
      ) : null}
      {url ? (
        <div className="fm-pub-linkrow">
          <StepBadge state="ok" label="Link" />
          <a className="fm-pub-linkrow__url" href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
          <Button size="sm" icon={Copy} onClick={() => void copyText(url, "link")}>
            {copied === "link" ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
      {outcome.kind === "review" && outcome.openedReview && reviewRef ? (
        <ReviewerPicker
          environmentId={environmentId}
          reference={reviewRef}
          chosen={reviewerName}
          onChosen={onReviewerRequested}
          onFailure={onFailure}
        />
      ) : null}
      <div className="fm-pub-result__actions">
        {url ? (
          <Button icon={ExternalLink} onClick={() => window.open(url, "_blank", "noreferrer")}>
            {outcome.kind === "live" ? "View on GitHub" : "Open the review"}
          </Button>
        ) : null}
        {outcome.kind === "live" &&
        data.linkRef &&
        data.detail?.capabilities.actions.includes("revert") ? (
          <TakeItBack
            environmentId={environmentId}
            reference={data.linkRef}
            onFailure={onFailure}
          />
        ) : null}
        <Button icon={Send} onClick={() => void copyText(summary, "summary")}>
          {copied === "summary" ? "Copied" : `Tell ${reviewerName ?? "your reviewer"} what changed`}
        </Button>
      </div>
      {copied === "summary" ? (
        <p className="fm-pub-help">
          A plain summary is on your clipboard — paste it into a message.
        </p>
      ) : null}
    </div>
  );
}

function ReviewerPicker({
  environmentId,
  reference,
  chosen,
  onChosen,
  onFailure,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly chosen: string | null;
  readonly onChosen: (name: string) => void;
  readonly onFailure: (error: unknown) => void;
}) {
  const candidates = useEnvironmentQuery(
    pullRequestReviewerCandidates({ environmentId, input: reference }),
  );
  const request = useAtomCommand(requestPullRequestReviewers, { reportFailure: false });
  const canRequest = useAtomValue(requestPullRequestReviewers.permissionAtom(environmentId));
  const [pending, setPending] = useState<string | null>(null);
  const list = candidates.data?.candidates ?? [];
  if (chosen !== null) return null;
  if (candidates.isPending && list.length === 0) {
    return <p className="fm-pub-help">Looking up who can review…</p>;
  }
  if (list.length === 0) return null;
  const pick = async (candidate: PullRequestReviewerCandidate) => {
    setPending(candidate.id);
    const result = await request({
      environmentId,
      input: {
        ...reference,
        reviewers: [{ id: candidate.id, kind: candidate.kind }],
        requested: true,
      },
    });
    setPending(null);
    if (result._tag === "Failure") {
      onFailure(squashAtomCommandFailure(result));
      return;
    }
    onChosen(reviewerDisplayName(candidate) ?? candidate.login);
  };
  return (
    <div className="fm-pub-reviewers">
      <span className="fm-pub-reviewers__label">Ask someone to review</span>
      <div className="fm-pub-reviewers__list">
        {list.slice(0, 8).map((candidate) => (
          <Button
            key={candidate.id}
            size="sm"
            icon={UserRound}
            disabled={!canRequest || pending !== null || candidate.isRequested}
            onClick={() => void pick(candidate)}
          >
            {pending === candidate.id
              ? "Asking…"
              : candidate.isRequested
                ? `${reviewerDisplayName(candidate)} (asked)`
                : reviewerDisplayName(candidate)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function TakeItBack({
  environmentId,
  reference,
  onFailure,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onFailure: (error: unknown) => void;
}) {
  const runAction = useAtomCommand(runPullRequestAction, { reportFailure: false });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  if (state === "done") {
    return (
      <Pill tone="ok" size="sm">
        Reversal opened for review
      </Pill>
    );
  }
  return (
    <Button
      icon={Undo2}
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        const result = await runAction({
          environmentId,
          input: { ...reference, action: "revert" },
        });
        if (result._tag === "Failure") {
          setState("idle");
          onFailure(squashAtomCommandFailure(result));
          return;
        }
        setState("done");
      }}
    >
      {state === "busy" ? "Taking it back…" : "Take it back"}
    </Button>
  );
}
