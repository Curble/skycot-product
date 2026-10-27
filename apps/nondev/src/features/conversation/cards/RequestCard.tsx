// The Apple-Pay-sheet style "May I…?" card for approval_request,
// user_input_request and secret_request. Everything it says comes from
// plain/approvals `describeRuntimeRequest`; this file only lays it out, builds
// the question form, and sends the chosen option's real payload. Nothing is
// pre-selected: every button is the same weight and none has focus.
import { useAtomValue } from "@effect/atom-react";
import { workRootsFor } from "@t3tools/skycot-rules/questions";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  OrchestrationV2Run,
  OrchestrationV2RuntimeRequest,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import {
  CircleHelp,
  KeyRound,
  type LucideIcon,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";

import {
  approvalNeedsBranch,
  type ApprovalCard,
  type ApprovalOption,
  type ApprovalRisk,
  childApprovalOptions,
  childApprovalSentence,
  describeDecision,
  describeRuntimeRequest,
  toolCallInputFor,
} from "../../../plain/approvals";
import { enforcedRuntimeMode } from "../../../plain/autonomy";
import { projectAtomOrEmpty } from "../../../state/projects";
import { vcsEnvironment } from "../../../state/vcs";
import { CrewAvatar } from "../../../themes/CrewAvatar";
import { useCrew } from "../../../themes/useCrew";
import { Banner } from "../../../ui/Banner";
import { Bubble } from "../../../ui/Bubble";
import { Button } from "../../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader, type CardIconTone } from "../../../ui/Card";
import { Disclosure } from "./Disclosure";
import { type DispatchDecision, useDecisionDispatcher } from "./dispatch";
import { InlineReply } from "./InlineReply";
import type { TimelineRenderContext } from "./registry";
import { shortTime } from "./time";
import {
  approves,
  ENGINE_CHECK_GRACE_MS,
  ENGINE_CHECK_LINE_DELAY_MS,
  familyCard,
  familyHoldFor,
  projectApprovalFor,
  projectFetchDescription,
  projectFetchSentence,
  isFamilyRefusal,
  toolItemTypeFor,
  waitsForEngineCheck,
} from "../../family/cards";
import { Mascot } from "../../brand/Mascot";
import { familyCopy } from "../../family/copy";
import { useFamily, useFamilySteps } from "../../family/FamilyProvider";
import { useChildView } from "../../../app/useChildView";
import { grownUpAnswerLabel, type GrownUpAnswer } from "../../../plain/grownUpAnswers";
import { useGrownUpAnswers } from "../useGrownUpAnswers";
import { answeredQuestionNote } from "./answeredQuestion";

type ApprovalItem = Extract<OrchestrationV2TurnItem, { type: "approval_request" }>;
type QuestionItem = Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>;
type SecretItem = Extract<OrchestrationV2TurnItem, { type: "secret_request" }>;
export type RequestItem = ApprovalItem | QuestionItem | SecretItem;

const PENDING_ITEM_STATUS = new Set<OrchestrationV2TurnItem["status"]>([
  "idle",
  "pending",
  "running",
  "waiting",
]);

function riskTone(risk: ApprovalRisk): CardIconTone {
  switch (risk) {
    case "low":
      return "blue";
    case "medium":
      return "orange";
    case "high":
    case "blocked":
      return "red";
  }
}

function iconFor(item: RequestItem, risk: ApprovalRisk): LucideIcon {
  if (item.type === "user_input_request") return CircleHelp;
  if (item.type === "secret_request") return KeyRound;
  return risk === "low" ? ShieldCheck : risk === "medium" ? ShieldAlert : TriangleAlert;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function projectCoverSentence(cover: "webSearch" | "addOns" | "internetFetch" | "internetAssets") {
  switch (cover) {
    case "webSearch":
      return "look things up on the internet";
    case "addOns":
      return "install the add-ons this project needs";
    case "internetFetch":
      return "fetch plain pages and data";
    case "internetAssets":
      return "load pictures, sounds, fonts and data from allowed sites";
  }
}

const SETTLED_RUN = new Set<OrchestrationV2Run["status"]>([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/**
 * True once the ask's run is going away: Stop was pressed (the engine may not
 * have confirmed yet) or the run already ended. An ask of such a run can no
 * longer be answered, so the card stops offering buttons at once.
 */
export function askRunEnded(
  item: RequestItem,
  projection: OrchestrationV2ThreadProjection,
  shell: EnvironmentThreadShell | null,
): boolean {
  if (item.runId === null) return false;
  const run = projection.runs.find((candidate) => candidate.id === item.runId);
  if (run && SETTLED_RUN.has(run.status)) return true;
  if (shell?.latestRun?.runId === item.runId && shell.source.latestRunStopRequested === true) {
    return true;
  }
  return projection.turnItems.some(
    (other) => other.type === "run_interrupt_request" && other.runId === item.runId,
  );
}

/** "You allowed this once · 8:42" once the request is settled; null while it waits. */
function decidedLine(
  item: RequestItem,
  request: OrchestrationV2RuntimeRequest | undefined,
  runEnded: boolean,
  grownUpAnswer?: GrownUpAnswer,
): string | null {
  const when = shortTime(request?.resolvedAt ?? item.completedAt ?? null);
  const stamp = when ? ` · ${when}` : "";
  if (item.type === "secret_request") {
    switch (item.secretStatus) {
      case "saved":
        return `Saved securely${stamp}`;
      case "declined":
        return `You chose not to share it${stamp}`;
      case "cancelled":
        return `No longer needed${stamp}`;
      default:
        return null;
    }
  }
  const pending = request ? request.status === "pending" : PENDING_ITEM_STATUS.has(item.status);
  if (pending) return runEnded ? "You stopped the assistant — nothing ran" : null;
  if (item.type === "approval_request") {
    const decision = request ? describeDecision(request) : null;
    // Answered by the server's SKYCOT rules, not by a person: say so calmly;
    // the rule detail sits under "Show details".
    if (decision?.decidedBy === "policy") return `Allowed by SKYCOT rules${stamp}`;
    if (grownUpAnswer !== undefined) return `${grownUpAnswerLabel(grownUpAnswer)}${stamp}`;
    return `${decision?.label ?? "No longer needed"}${stamp}`;
  }
  if (request?.answers !== undefined) return `You answered${stamp}`;
  if (request?.status === "resolved" || item.status === "completed")
    return `You skipped this${stamp}`;
  return `No longer needed${stamp}`;
}

/** Apple order: the refusal sits left, the allows follow; a hard stop goes last. */
const BUTTON_ORDER: Record<string, number> = {
  decline: 0,
  skip: 0,
  accept: 1,
  answer: 1,
  save: 1,
  message: 1,
  acceptForSession: 2,
  acceptAlways: 3,
  cancel: 4,
  interrupt: 4,
};

function orderOptions(options: ReadonlyArray<ApprovalOption>): Array<ApprovalOption> {
  return [...options].sort((a, b) => (BUTTON_ORDER[a.id] ?? 9) - (BUTTON_ORDER[b.id] ?? 9));
}

export function RequestCard({
  item,
  context,
}: {
  readonly item: RequestItem;
  readonly context: TimelineRenderContext;
}) {
  const { projection, environmentId, threadId, shell, projectName } = context;
  const project = useAtomValue(
    projectAtomOrEmpty({ environmentId, projectId: shell?.projectId ?? null }),
  );
  const request =
    item.type === "secret_request"
      ? undefined
      : projection.runtimeRequests.find((r) => r.id === item.requestId);
  const toolCallInput =
    item.type === "approval_request" ? toolCallInputFor(item, projection.turnItems) : undefined;
  // Files live in the thread's private copy when it has one; the project's
  // own folder is inside too, so only a path under neither is "outside". A
  // question works in its own folder only, as the engine judges it.
  const { projectRoot, projectFolder } = workRootsFor({
    projectFolder: project?.workspaceRoot ?? null,
    worktreePath: shell?.worktreePath ?? null,
    questionsRoot: project?.isScratch ? project.workspaceRoot : null,
  });
  // A push is judged by branch, as the server's policy judged it: the thread's
  // own branch first, else the folder's; the live branch from the folder. Only
  // a push ask pays for the status lookup.
  const needsBranch = projectRoot !== null && approvalNeedsBranch(item, toolCallInput);
  const vcsStatus = useEnvironmentQuery(
    needsBranch ? vcsEnvironment.status({ environmentId, input: { cwd: projectRoot } }) : null,
  ).data;
  const crew = useCrew();
  const family = useFamily();
  const childView = useChildView();
  const card = describeRuntimeRequest(item, {
    ...(crew.named ? { assistantName: crew.builder.name } : {}),
    ...(projectName === null ? {} : { projectName }),
    ...(projectRoot === null ? {} : { projectRoot }),
    ...(projectFolder === null ? {} : { projectFolder }),
    ...(needsBranch
      ? {
          currentBranch: shell?.branch ?? vcsStatus?.refName ?? null,
          defaultBranch:
            vcsStatus?.branchChanges?.baseRef ??
            (vcsStatus?.isDefaultRef ? vcsStatus.refName : null),
        }
      : {}),
    ...(request ? { responseCapability: request.responseCapability.type } : {}),
    ...(shell && enforcedRuntimeMode(shell.runtimeMode, family.enabled) === "full-access"
      ? { handsOff: true }
      : {}),
    ...(toolCallInput === undefined ? {} : { toolCallInput }),
  });
  // Family profile: the same rules the engine enforces say which cards need a grown-up.
  const familyApplies = family.enabled && item.type === "approval_request";
  const grownUp =
    familyApplies && item.type === "approval_request"
      ? familyHoldFor(item, {
          projectRoot,
          projectFolder,
          toolCallInput,
          toolItemType: toolItemTypeFor(item, projection.turnItems),
          trustedAddOns: family.profile.trustedAddOns,
        })
      : null;
  const shown = familyApplies ? familyCard(card, grownUp) : card;
  const projectCover =
    familyApplies && item.type === "approval_request"
      ? projectApprovalFor(item, {
          projectRoot,
          projectFolder,
          toolCallInput,
          toolItemType: toolItemTypeFor(item, projection.turnItems),
          trustedAddOns: family.profile.trustedAddOns,
        })
      : null;
  const fetchSentence =
    projectCover === "internetFetch" && item.type === "approval_request"
      ? projectFetchSentence(
          toolCallInput ?? item.prompt ?? card.technical,
          crew.named ? crew.builder.name : "Sam",
        )
      : null;
  const fetchDescription =
    projectCover === "internetFetch" && item.type === "approval_request"
      ? projectFetchDescription(toolCallInput ?? item.prompt ?? card.technical)
      : null;
  const remoteGrownUps = family.profile.devices.some((device) => device.kind === "grown-up");
  const grownUpNames = family.profile.grownUps
    .map((person) => person.name)
    .filter((name): name is string => name !== null);
  // Family: a step the child needn't be asked about is the engine's to answer (safe steps run
  // by themselves), so it shows a quiet line for a moment instead of a card with buttons.
  const steps = useFamilySteps();
  const runEnded = askRunEnded(item, projection, shell);
  // A child is told which grown-up answered ("Mum said yes · 8:42"), not "You allowed this once".
  const answers = useGrownUpAnswers(
    threadId,
    request?.status ?? item.status,
    childView && grownUp !== null && request !== undefined && request.status !== "pending",
  );
  const grownUpAnswer =
    childView && item.type === "approval_request" ? answers.get(item.requestId) : undefined;
  const decided = decidedLine(item, request, runEnded, grownUpAnswer);
  const questionTitle =
    childView && item.type === "user_input_request" ? "Sam has a question" : null;
  const decision = request ? describeDecision(request) : null;
  const checking = waitsForEngineCheck({
    familyOn: familyApplies,
    isApproval: item.type === "approval_request",
    decided: decided !== null,
    needsGrownUp: grownUp !== null,
    askEachStep: steps?.askEachStep ?? true,
    grownUpDevice: family.profile.me.kind === "grown-up",
  });
  const [graceOver, setGraceOver] = useState(false);
  const [checkLineVisible, setCheckLineVisible] = useState(false);
  useEffect(() => {
    if (!checking) return;
    setGraceOver(false);
    setCheckLineVisible(false);
    const lineTimer = window.setTimeout(
      () => setCheckLineVisible(true),
      ENGINE_CHECK_LINE_DELAY_MS,
    );
    const timer = window.setTimeout(() => setGraceOver(true), ENGINE_CHECK_GRACE_MS);
    return () => {
      window.clearTimeout(lineTimer);
      window.clearTimeout(timer);
    };
  }, [checking]);
  const dispatch = useDecisionDispatcher({ environmentId, threadId, shell });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A new ask lands keyboard focus on the card itself (not a button, so
  // nothing is pre-selected) unless the person is typing somewhere; from the
  // card, one Tab reaches "Don't allow". Sighted mouse users notice nothing.
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingOnMount = decided === null;
  useEffect(() => {
    if (!pendingOnMount) return;
    const activeElement = document.activeElement;
    const typing =
      activeElement instanceof HTMLElement &&
      (activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "INPUT" ||
        activeElement.isContentEditable);
    if (typing) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [pendingOnMount]);

  // A question the child already answered leaves the thread quietly (their answer shows as
  // a small note). After every hook above: changing the hooks in this card mid-life crashes the
  // whole window (React's hook order rule).
  if (childView && item.type === "user_input_request" && request?.answers !== undefined) {
    const note = answeredQuestionNote(card.whatItWants, request.answers);
    return (
      <Bubble author="crew" full meta={shortTime(request.resolvedAt)}>
        <div className="fm-request-answer" data-sober="">
          <p>{note.asked}</p>
          <p>{note.answered}</p>
        </div>
      </Bubble>
    );
  }

  const choose = async (
    option: ApprovalOption,
    extras?: Parameters<DispatchDecision>[1],
    scope: "once" | "project" = "once",
  ) => {
    // Never answer into a stopped run, even from a click that raced the Stop.
    if (askRunEnded(item, projection, shell)) return;
    const askParent = () =>
      item.type === "approval_request"
        ? family.requireParentCode("approve", { requestId: item.requestId, reason: grownUp, scope })
        : Promise.resolve(false);
    const needsParent = familyApplies && approves(option);
    if (needsParent && grownUp !== null && !(await askParent())) return;
    setBusyId(option.id);
    setProblem(null);
    let result = await dispatch(option.decision, extras);
    // The engine had the final say and wanted a grown-up after all: ask, then try once more.
    if (result !== null && needsParent && grownUp === null && isFamilyRefusal(result)) {
      setBusyId(null);
      if (!(await askParent())) {
        setProblem(result);
        return;
      }
      setBusyId(option.id);
      result = await dispatch(option.decision, extras);
    }
    setBusyId(null);
    if (result !== null) setProblem(result);
  };

  if (checking && !graceOver && checkLineVisible) {
    return (
      <Bubble author="crew" full meta={shortTime(item.startedAt ?? item.updatedAt)}>
        <p className="fm-help" role="status">
          {familyCopy.checkingStep}
        </p>
      </Bubble>
    );
  }

  const tone = riskTone(card.risk);
  const Icon = iconFor(item, card.risk);
  const classes = [
    "fm-approval",
    `fm-approval--${card.risk}`,
    decided ? "fm-approval--decided" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Bubble
      author="crew"
      full
      meta={decided ? undefined : shortTime(item.startedAt ?? item.updatedAt)}
    >
      {grownUp !== null && !decided ? (
        // Outside the sober region on purpose: the card below stays plain in every theme.
        <p className="fm-mascot-kicker">
          <Mascot pose="ask-a-grown-up" size={40} decorative />
          {childView ? "A grown-up can help." : familyCopy.fetchGrownUp}
        </p>
      ) : null}
      <div className={classes} ref={cardRef} tabIndex={decided ? undefined : -1} data-sober="">
        {crew.named && !decided && !(childView && grownUp !== null) ? (
          <p className="fm-crew-kicker">
            <CrewAvatar role="builder" size="sm" />
            {childView && item.type === "user_input_request"
              ? "Sam has a question"
              : item.type === "approval_request"
                ? `${crew.builder.name} needs your OK`
                : item.type === "secret_request"
                  ? `${crew.builder.name} needs a key from you`
                  : `${crew.builder.name} has a question`}
          </p>
        ) : null}
        <Card
          label={
            childView && decided
              ? decided
              : childView && grownUp !== null
                ? "A grown-up is needed"
                : (questionTitle ?? card.title)
          }
        >
          <CardHeader
            icon={Icon}
            tone={decided ? "grey" : tone}
            title={
              childView && decided
                ? decided
                : childView && grownUp !== null
                  ? "A grown-up is needed"
                  : grownUp !== null
                    ? "Allow this step?"
                    : (questionTitle ?? card.title)
            }
            subtitle={
              childView && decided
                ? undefined
                : (decided ??
                  (childView && grownUp !== null
                    ? "Waiting for a grown-up"
                    : grownUp !== null
                      ? "Choose Allow or Not now"
                      : card.ruleTitle
                        ? `${card.ruleTitle} · waiting for you`
                        : "Waiting for you · nothing is pre-selected"))
            }
          />
          <CardBody>
            {childView && decided ? null : (
              <p className="fm-approval__what">
                {childView && grownUp !== null
                  ? (fetchSentence ??
                    childApprovalSentence(card, crew.named ? crew.builder.name : "Sam"))
                  : fetchDescription === null
                    ? card.whatItWants
                    : family.profile.childName
                      ? `${family.profile.childName}'s page wants to download ${fetchDescription}.`
                      : `This page wants to download ${fetchDescription}.`}
              </p>
            )}
            {projectCover !== null && grownUp !== null && !decided && !childView ? (
              <p className="fm-help">
                Goal: {shell?.title ?? "this conversation"}. For {projectName ?? "this project"}:{" "}
                {projectCoverSentence(projectCover)}. This lasts 30 days.
              </p>
            ) : null}
            {childView && !decided && grownUp !== null && remoteGrownUps ? (
              <p className="fm-help">
                {grownUpNames.length > 0
                  ? `We've let ${grownUpNames[0]} know on their phone. Or a grown-up can type the code here.`
                  : "We've let a grown-up know on their phone. Or a grown-up can type the code here."}
              </p>
            ) : null}
            {decided || (childView && grownUp !== null) ? null : (
              <dl className="fm-kv">
                <dt>Why it matters</dt>
                <dd>{card.whyItMatters}</dd>
                <dt>Where it reaches</dt>
                <dd>
                  <b>{capitalize(card.scope)}.</b> {card.scopeExplainer}
                </dd>
                {card.sizeOrCost ? (
                  <>
                    <dt>Size or cost</dt>
                    <dd>{card.sizeOrCost}</dd>
                  </>
                ) : null}
                <dt>If you say no</dt>
                <dd>{card.ifYouSayNo}</dd>
              </dl>
            )}
            {card.warning && !decided && !(childView && grownUp !== null) ? (
              <p className="fm-approval__warning" role="alert">
                <TriangleAlert size={14} strokeWidth={2} aria-hidden />
                <span>{card.warning}</span>
              </p>
            ) : null}
            {decided || (childView && grownUp !== null) ? null : item.type ===
              "user_input_request" ? (
              <QuestionForm item={item} card={card} busy={busyId !== null} onChoose={choose} />
            ) : childView && item.type === "secret_request" ? (
              <p className="fm-help">
                {crew.named
                  ? `${crew.builder.name} needs something only a grown-up can give.`
                  : "Sam needs something only a grown-up can give."}
              </p>
            ) : item.type === "secret_request" ? (
              <SecretForm item={item} card={card} busyId={busyId} onChoose={choose} />
            ) : null}
            {grownUp !== null && !decided && !(childView && grownUp !== null) ? (
              <Banner tone="info">{grownUp} A grown-up enters the parent code to allow it.</Banner>
            ) : null}
            {problem ? (
              <div className="fm-card__problem">
                <Banner tone="warning">{problem}</Banner>
              </div>
            ) : null}
            {childView && grownUp !== null ? null : (
              <Disclosure>
                {decision?.decidedBy === "policy" ? (
                  <p className="fm-details__empty">Decision: {decision.label}.</p>
                ) : null}
                <pre className="fm-details__pre">
                  <code>{card.technical}</code>
                </pre>
              </Disclosure>
            )}
          </CardBody>
          {decided || item.type !== "approval_request" ? null : family.profile.me.kind ===
            "grown-up" ? (
            // A grown-up's phone answers on its Requests page (Allow once or Decline, checked
            // there by the engine); this page only reads. A step the child may allow themselves
            // is never listed there: it is answered at the Mac.
            <CardFooter>
              <p className="fm-help">
                {grownUp !== null
                  ? "Answer this on the Requests page."
                  : "This one doesn't need a grown-up. It's answered at the Mac."}
              </p>
            </CardFooter>
          ) : (
            <CardFooter>
              <div className="fm-approval__actions">
                {(childView && grownUp !== null
                  ? childApprovalOptions(shown.options)
                  : orderOptions(shown.options)
                ).map((option) => (
                  <Button
                    key={option.id}
                    size="md"
                    variant={option.tone === "danger" ? "destructive" : "secondary"}
                    disabled={busyId !== null}
                    title={option.warning}
                    onClick={() => void choose(option)}
                  >
                    {busyId === option.id
                      ? "Sending…"
                      : familyApplies && family.profile.me.kind === "grown-up"
                        ? option.id === "accept" || option.id === "acceptForSession"
                          ? "Allow"
                          : option.id === "decline"
                            ? "Not now"
                            : option.label
                        : option.label}
                  </Button>
                ))}
                {projectCover !== null && grownUp !== null && !childView ? (
                  <Button
                    size="md"
                    variant="secondary"
                    disabled={busyId !== null}
                    onClick={() => {
                      const option = shown.options.find(approves);
                      if (option) void choose(option, undefined, "project");
                    }}
                  >
                    {busyId !== null ? "Sending…" : "Allow for this project"}
                  </Button>
                ) : null}
              </div>
            </CardFooter>
          )}
        </Card>
      </div>
    </Bubble>
  );
}

interface DraftAnswer {
  readonly selected: ReadonlyArray<string>;
  readonly custom: string;
}

function QuestionForm({
  item,
  card,
  busy,
  onChoose,
}: {
  readonly item: QuestionItem;
  readonly card: ApprovalCard;
  readonly busy: boolean;
  readonly onChoose: (option: ApprovalOption, extras?: Parameters<DispatchDecision>[1]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const answerOption = card.options.find((o) => o.id === "answer");
  const skipOption = card.options.find((o) => o.id === "skip");
  const messageOption = card.options.find((o) => o.id === "message");

  if (card.answerByMessage && messageOption) {
    return (
      <div className="fm-question">
        {item.questions.map((question) => (
          <div key={question.id} className="fm-question__block">
            <span className="fm-question__header">{question.header}</span>
            <p className="fm-question__text">{question.question}</p>
          </div>
        ))}
        <InlineReply
          label="Your answer"
          placeholder="Type your answer…"
          sendLabel={messageOption.label}
          busy={busy}
          autoFocus={false}
          onSend={(text) => onChoose(messageOption, { text })}
        />
      </div>
    );
  }

  const draftFor = (id: string): DraftAnswer => drafts[id] ?? { selected: [], custom: "" };
  const valueFor = (
    question: QuestionItem["questions"][number],
  ): string | ReadonlyArray<string> | null => {
    const draft = draftFor(question.id);
    const custom = question.allowCustomAnswer === false ? "" : draft.custom.trim();
    if (custom.length > 0) return custom;
    if (draft.selected.length === 0) return null;
    return question.multiSelect ? draft.selected : draft.selected[0]!;
  };
  const complete = item.questions.every(
    (question) => question.required === false || valueFor(question) !== null,
  );
  const answers = Object.fromEntries(
    item.questions
      .map((question) => [question.id, valueFor(question)] as const)
      .filter(
        (entry): entry is readonly [string, string | ReadonlyArray<string>] => entry[1] !== null,
      ),
  );

  return (
    <div className="fm-question">
      {item.questions.map((question) => {
        const draft = draftFor(question.id);
        const chosen = question.options.filter((o) => draft.selected.includes(o.value ?? o.label));
        return (
          <fieldset key={question.id} className="fm-question__block">
            <legend className="fm-question__header">{question.header}</legend>
            <p className="fm-question__text">{question.question}</p>
            {question.options.length > 0 ? (
              <div className="fm-chips" role="group" aria-label={question.header}>
                {question.options.map((option) => {
                  const value = option.value ?? option.label;
                  const on = draft.selected.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`fm-chip${on ? " fm-chip--on" : ""}`}
                      aria-pressed={on}
                      disabled={busy}
                      onClick={() =>
                        setDrafts((prev) => ({
                          ...prev,
                          [question.id]: {
                            ...draftFor(question.id),
                            selected: question.multiSelect
                              ? on
                                ? draft.selected.filter((v) => v !== value)
                                : [...draft.selected, value]
                              : on
                                ? []
                                : [value],
                          },
                        }))
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {chosen.length > 0 ? (
              <p className="fm-question__description">
                {chosen.map((o) => o.description).join(" · ")}
              </p>
            ) : null}
            {question.allowCustomAnswer === false ? null : (
              <textarea
                className="fm-question__custom"
                rows={2}
                placeholder={
                  question.options.length > 0 ? "Or type your own answer…" : "Type your answer…"
                }
                value={draft.custom}
                disabled={busy}
                aria-label={`Your own answer to: ${question.header}`}
                onChange={(event) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [question.id]: { ...draftFor(question.id), custom: event.currentTarget.value },
                  }))
                }
              />
            )}
          </fieldset>
        );
      })}
      <div className="fm-approval__actions">
        {skipOption ? (
          <Button disabled={busy} onClick={() => onChoose(skipOption)}>
            {skipOption.label}
          </Button>
        ) : null}
        {answerOption ? (
          <Button
            variant={complete ? "primary" : "secondary"}
            disabled={busy || !complete}
            onClick={() => onChoose(answerOption, { answers })}
          >
            {busy ? "Sending…" : answerOption.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SecretForm({
  item,
  card,
  busyId,
  onChoose,
}: {
  readonly item: SecretItem;
  readonly card: ApprovalCard;
  readonly busyId: string | null;
  readonly onChoose: (option: ApprovalOption, extras?: Parameters<DispatchDecision>[1]) => void;
}) {
  const id = useId();
  const [secret, setSecret] = useState("");
  const save = card.options.find((o) => o.id === "save");
  const decline = card.options.find((o) => o.id === "decline");
  const canSave = secret.trim().length > 0 && busyId === null;
  const submit = () => {
    if (!save || !canSave) return;
    // The value goes straight to the secrets RPC; the plain layer never sees it.
    onChoose(save, { secret });
    setSecret("");
  };
  return (
    <form
      className="fm-secret"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="fm-field-label">
        {item.label}
      </label>
      <input
        id={id}
        className="fm-field fm-field--mono"
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={item.placeholder ?? "Paste the key here"}
        value={secret}
        disabled={busyId !== null}
        onChange={(event) => setSecret(event.currentTarget.value)}
      />
      <p className="fm-secret__note">
        Stored only on this Mac and handed to the assistant once. It never appears in the chat.
      </p>
      <div className="fm-approval__actions">
        {decline ? (
          <Button type="button" disabled={busyId !== null} onClick={() => onChoose(decline)}>
            {busyId === "decline" ? "Sending…" : decline.label}
          </Button>
        ) : null}
        {save ? (
          <Button type="submit" variant={canSave ? "primary" : "secondary"} disabled={!canSave}>
            {busyId === "save" ? "Saving…" : save.label}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
