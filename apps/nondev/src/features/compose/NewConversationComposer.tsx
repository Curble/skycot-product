import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProviderInteractionMode, ServerConfig, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { AlertCircle, ChevronDown, Info, MessageCircleQuestion } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { newThreadId, randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { CrewName } from "../../themes/CrewName";
import { useCrew } from "../../themes/useCrew";
import { navigate, threadHref } from "../../router";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import {
  readAutonomy,
  useLastProject,
  writeAutonomy,
  writeLastProject,
} from "../../state/preferences";
import { useDefaultAssistantPreference } from "../../state/defaultAssistant";
import { providerForSelection, resolveDefaultModelSelection } from "../../state/providers";
import { serverEnvironment } from "../../state/server";
import { canOperateEnvironmentAtom } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { vcsActionManager, vcsEnvironment } from "../../state/vcs";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { MenuItem, Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { ProjectAvatar } from "../../app/ProjectAvatar";
import { useColumns } from "../../app/useColumns";
import { useShortWindow } from "../../app/useShortWindow";
import { useChildView } from "../../app/useChildView";
import { useConnected } from "../../app/useConnection";
import { catalogEntryFor } from "../settings/providerCatalog";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { FamilyAutonomyLock } from "../family/FamilyLock";
import { useFamily, useFamilySteps } from "../family/FamilyProvider";
import { noteStartedHere } from "../family-limits/store";
import { familyApi } from "../family/api"; // nondev-seam: skycot-project-memory
import { describeAutonomyLevel, hardRulesStatement } from "../../plain/autonomy";
import {
  autonomyLabel,
  autonomyLevelOf,
  PLAIN_AUTONOMY_OPTIONS,
  plainAutonomyOrDefault,
  runtimeModeFor,
  type Autonomy,
} from "./autonomy";
import { firstBlank, starterMessageText, stillFromStarter } from "../starters/starters";
import type { ComposerSeed } from "../starters/StarterCards";
import { useShield, type ShieldOutcome } from "../shield";
import { firstMessageLabels } from "./firstMessage";
import { MessageField } from "./MessageField";
import { PlanFirstSwitch } from "./PlanFirstSwitch";
import { requestMode, usePlanFirst } from "./planFirst";
import { usePictures } from "./usePictures";
import {
  folderReadiness,
  plainPrivateCopyProblem,
  PRIVATE_COPY_COPY,
  shouldAskTrackingSheet,
  STARTER_GITIGNORE,
} from "./privateCopy";
import { rememberStartNote } from "./startNotes";
import {
  composeTargetFor,
  isQuestionsProject,
  JUST_ASK_COPY,
  keyOf,
  QUESTION_KEY,
  realProjects,
} from "../questions/questions";
import { TrackingSheet, type TrackingChoice } from "./TrackingSheet";

/**
 * The Home compose box: project chip, autonomy choice, message. Sending creates
 * a thread in the chosen project inside its own private copy (a Git worktree,
 * which is what lets the engine undo and restore), starts the first turn and
 * opens it. "Just ask" sends it to the Questions space instead: the engine gives
 * the question a private folder of its own, outside the person's folders.
 */
export function NewConversationComposer({
  preferredProjectKey,
  seed = null,
}: {
  /** `${environmentId}:${projectId}` from the sidebar selection, when any. */
  readonly preferredProjectKey: string | null;
  /** A starter card's prompt: replaces the box's text each time a card is tapped. */
  readonly seed?: ComposerSeed | null;
}) {
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const lastProject = useLastProject();
  const columns = useColumns();
  const connected = useConnected();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const config = useAtomValue(
    environmentIds[0] === undefined
      ? EMPTY_CONFIG_ATOM
      : serverEnvironment.configValueAtom(environmentIds[0]),
  );
  // Only the server can say whether the hard rules are enforced; the copy
  // never claims more than it reports.
  const policyEnforced = config?.skycotPolicy === true;
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const family = useFamily();
  const childView = useChildView();
  const crew = useCrew();
  // Family: how this child's steps run (safe steps by themselves, unless a parent chose
  // "Ask before each step"), instead of "Ask me first … before every command".
  const familySteps = useFamilySteps();
  // Plain surfaces offer only the levels that keep a safety promise; a stored
  // "hands-off" (from Advanced mode) shows as asking first. The Family profile
  // pins it to asking first.
  const [chosenAutonomy, setAutonomy] = useState<Autonomy>(() =>
    plainAutonomyOrDefault(readAutonomy()),
  );
  const autonomy: Autonomy = family.enabled ? "ask-first" : chosenAutonomy;
  const planFirst = usePlanFirst();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [appliedSeed, setAppliedSeed] = useState<ComposerSeed | null>(null);
  if (seed !== appliedSeed) {
    setAppliedSeed(seed);
    if (seed !== null) setText(seed.text);
  }
  // Once the card's words are in, put the cursor on the first [blank] to type over.
  useEffect(() => {
    const field = inputRef.current;
    if (appliedSeed === null || field === null) return;
    field.focus();
    const blank = firstBlank(field.value);
    if (blank !== null) field.setSelectionRange(blank.start, blank.end);
    field.scrollIntoView({ block: "nearest" });
  }, [appliedSeed]);

  // Only an engine whose data folder is outside any Git checkout offers Questions.
  const questionsAvailable =
    Boolean(config?.scratchWorkspaceRoot) && environmentIds[0] !== undefined;
  const ownProjects = realProjects(projects);
  const questionsProject = projects.find((candidate) => isQuestionsProject(candidate)) ?? null;
  // Nothing chosen, nothing remembered and several projects: ask, rather than
  // aim the first message at whichever project happens to be listed first.
  const target = composeTargetFor({
    projects,
    questionsAvailable,
    chosen: chosenKey,
    preferredKey: preferredProjectKey,
    last: lastProject,
  });
  const project = target?.kind === "project" ? target.project : null;
  const asking = target?.kind === "question";
  const phone = columns === 1;
  // On a phone or a laptop-height window the explanation folds away (F8): the pills already
  // say what is on, and the message box and the Home screen get the room.
  const shortWindow = useShortWindow();
  const foldNotes = phone || shortWindow;
  const [notesOpen, setNotesOpen] = useState(false);
  const notesId = useId();
  const showNotes = !foldNotes || notesOpen;
  const nothingToPick = ownProjects.length === 0 && !questionsAvailable;

  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        <div className="fm-composer__context">
          {!childView || ownProjects.length > 1 ? (
            <Popover
              label="Project"
              // The message box sits at the bottom of the window: open upwards so every
              // project (and Just ask) stays on screen.
              placement="top-start"
              trigger={
                <Button size="sm" disabled={nothingToPick}>
                  {asking ? (
                    <MessageCircleQuestion size={14} strokeWidth={1.8} aria-hidden />
                  ) : project ? (
                    <ProjectAvatar project={project} size="sm" />
                  ) : null}
                  {asking
                    ? JUST_ASK_COPY.choice
                    : project
                      ? childView
                        ? "Your project"
                        : project.title
                      : nothingToPick
                        ? connected
                          ? "No project yet"
                          : "Waiting for your Mac…"
                        : "Choose a project"}
                  <ChevronDown size={12} strokeWidth={2} aria-hidden />
                </Button>
              }
            >
              {(close) => (
                <>
                  {questionsAvailable ? (
                    <MenuItem
                      checked={asking}
                      onSelect={() => {
                        setChosenKey(QUESTION_KEY);
                        // Remembered once the space exists (after the first question).
                        if (questionsProject) {
                          writeLastProject({
                            environmentId: questionsProject.environmentId,
                            projectId: questionsProject.id,
                          });
                        }
                        close();
                      }}
                    >
                      <span className="fm-menu-item__two">
                        <span>{JUST_ASK_COPY.choice}</span>
                        <small>{JUST_ASK_COPY.choiceHint}</small>
                      </span>
                    </MenuItem>
                  ) : null}
                  {questionsAvailable && ownProjects.length > 0 ? (
                    <div className="fm-menu-sep" role="separator" />
                  ) : null}
                  {ownProjects.map((candidate, index) => (
                    <MenuItem
                      key={keyOf(candidate)}
                      checked={project !== null && keyOf(candidate) === keyOf(project)}
                      onSelect={() => {
                        setChosenKey(keyOf(candidate));
                        // Remembered at once, so a detour through Settings does not reset it.
                        writeLastProject({
                          environmentId: candidate.environmentId,
                          projectId: candidate.id,
                        });
                        close();
                      }}
                    >
                      {childView ? `Project ${index + 1}` : candidate.title}
                    </MenuItem>
                  ))}
                </>
              )}
            </Popover>
          ) : null}
          {family.enabled ? (
            childView ? (
              <span className="fm-composer__label">
                {crew.builder.name} shows you a plan first. Then you press Build it.
              </span>
            ) : (
              <FamilyAutonomyLock planFirst />
            )
          ) : (
            <>
              <span className="fm-composer__label">
                How much should <CrewName /> do on its own?
              </span>
              <SegmentedControl
                label="Autonomy"
                size="sm"
                wrap={phone}
                block={phone}
                value={autonomy}
                onChange={(next) => {
                  setAutonomy(next);
                  writeAutonomy(next);
                }}
                options={PLAIN_AUTONOMY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  ...(option.tag ? { tag: option.tag } : {}),
                }))}
              />
              <PlanFirstSwitch />
            </>
          )}
          {foldNotes && !childView ? (
            <Button
              size="sm"
              variant="plain"
              icon={Info}
              aria-expanded={notesOpen}
              aria-controls={notesId}
              onClick={() => setNotesOpen((open) => !open)}
            >
              {notesOpen ? "Hide" : phone ? "What's this?" : "What does this mean?"}
            </Button>
          ) : null}
        </div>
        {showNotes && !childView ? (
          <div id={notesId}>
            {/* One sentence for the chosen level, not a paragraph about every level. */}
            <p className="fm-help" style={{ marginBottom: 6 }}>
              {familySteps === null ? (
                <>
                  <b>{autonomyLabel(autonomy)}.</b>{" "}
                  {describeAutonomyLevel(autonomyLevelOf(autonomy), { policyEnforced })}
                </>
              ) : (
                <>
                  <b>{familySteps.label}.</b> {familySteps.description}
                </>
              )}
              {planFirst.on ? (
                <>
                  {" "}
                  <b>Plan first.</b> You'll see the plan before anything changes.
                </>
              ) : null}
            </p>
            <p className="fm-rule" style={{ marginBottom: 10 }}>
              <span className="fm-rule__icon">
                <AlertCircle size={14} strokeWidth={1.8} aria-hidden />
              </span>
              <span>{hardRulesStatement(policyEnforced, undefined, family.enabled)}</span>
            </p>
          </div>
        ) : null}
        {problem ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="warning">{problem}</Banner>
          </div>
        ) : null}
        {target !== null && environmentIds[0] !== undefined ? (
          <ComposerField
            environmentId={project?.environmentId ?? environmentIds[0]}
            project={project}
            autonomy={autonomy}
            interactionMode={requestMode(planFirst)}
            text={text}
            onText={setText}
            sending={sending}
            connected={connected}
            phone={phone}
            inputRef={inputRef}
            wantsPicture={appliedSeed?.wantsPicture === true}
            seed={appliedSeed}
            onSend={async (send) => {
              setSending(true);
              setProblem(null);
              const outcome = await send();
              setSending(false);
              if (outcome.kind === "failed") setProblem(outcome.message);
              else if (outcome.kind === "started") setText("");
            }}
          />
        ) : (
          <MessageField
            inputRef={inputRef}
            value={text}
            onChange={setText}
            onSend={() => {}}
            canSend={false}
            disabled
            placeholder={
              nothingToPick
                ? connected
                  ? "Open a folder in the sidebar first, then say what you'd like done"
                  : "Waiting for your Mac…"
                : questionsAvailable
                  ? "Choose a project above, or Just ask"
                  : "Choose a project above, then say what you'd like done"
            }
          />
        )}
      </div>
    </div>
  );
}

const EMPTY_CONFIG_ATOM = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("nondev-composer-config:empty"),
);

type SendOutcome =
  | { readonly kind: "started" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

function ComposerField({
  environmentId,
  project,
  autonomy,
  interactionMode,
  text,
  onText,
  sending,
  connected,
  phone,
  inputRef,
  wantsPicture,
  seed,
  onSend,
}: {
  readonly environmentId: EnvironmentProject["environmentId"];
  /** Null for "Just ask": the question goes to the Questions space. */
  readonly project: EnvironmentProject | null;
  readonly autonomy: Autonomy;
  /** "plan" while plan first is on. */
  readonly interactionMode: ProviderInteractionMode;
  readonly text: string;
  readonly onText: (value: string) => void;
  readonly sending: boolean;
  readonly connected: boolean;
  readonly phone: boolean;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  /** "Draw it, then build it": the box hints at the + button until a picture is added. */
  readonly wantsPicture: boolean;
  /** The starter card the box was filled from; its hidden rules go along while the words stand. */
  readonly seed: ComposerSeed | null;
  readonly onSend: (send: () => Promise<SendOutcome>) => Promise<void>;
}) {
  const childView = useChildView();
  const crew = useCrew();
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const preference = useDefaultAssistantPreference(environmentId);
  const modelSelection = resolveDefaultModelSelection(providers, project, preference);
  const provider = providerForSelection(providers, modelSelection);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  // A question has no folder until the engine makes one; no Git calls run for it.
  const cwd = project?.workspaceRoot ?? "";
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const initRepository = useAtomCommand(vcsEnvironment.init, { reportFailure: false });
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const commitAll = useAtomCommand(vcsActionManager.runStackedAction({ environmentId, cwd }), {
    reportFailure: false,
  });
  const [phase, setPhase] = useState<string | null>(null);
  const pictures = usePictures();
  const family = useFamily();
  // Family profile: a full name, school, address or photo waits for the child's pick first.
  const shield = useShield();
  const [tracking, setTracking] = useState<{
    readonly resolve: (choice: TrackingChoice) => void;
  } | null>(null);

  // Send is only live when the Mac can actually take the message.
  const ready = canOperate && modelSelection !== null && connected;
  const trimmed = text.trim();

  const askTracking = () =>
    new Promise<TrackingChoice>((resolve) => {
      setTracking({
        resolve: (choice) => {
          setTracking(null);
          resolve(choice);
        },
      });
    });

  /**
   * The branch the private copy starts from, or the plain reason there can't
   * be one. A folder with no history gets `git init` and a first saved version
   * so there is something to copy, but only after the person has agreed to it:
   * writing a `.git` folder and a version of every file into someone's folder
   * is not something to do silently.
   */
  const prepareFolder = async (
    project: EnvironmentProject,
  ): Promise<
    { readonly baseBranch: string } | { readonly reason: string } | { readonly cancelled: true }
  > => {
    const first = await refreshStatus({ environmentId, input: { cwd } });
    if (first._tag === "Failure") {
      console.warn("[skycot] git status failed:", squashAtomCommandFailure(first));
      return { reason: "SKYCOT couldn't read this folder's history." };
    }
    let readiness = folderReadiness(first.value);
    if (readiness.kind === "needs-init") {
      const recorded = await familyApi.isSkycotCreatedFolder(cwd);
      const createdBySkycot = recorded.ok && recorded.value;
      const choice = shouldAskTrackingSheet(readiness, createdBySkycot)
        ? await askTracking()
        : { confirmed: true, starterIgnore: true };
      if (!choice.confirmed) return { cancelled: true };
      setPhase(PRIVATE_COPY_COPY.settingUp);
      if (choice.starterIgnore) {
        const written = await writeFile({
          environmentId,
          input: { cwd, relativePath: ".gitignore", contents: STARTER_GITIGNORE },
        });
        // Not fatal: the folder is still tracked, just without the safety list.
        if (written._tag === "Failure") {
          console.warn("[skycot] starter .gitignore failed:", squashAtomCommandFailure(written));
        }
      }
      const inited = await initRepository({ environmentId, input: { cwd } });
      if (inited._tag === "Failure") {
        console.warn("[skycot] git init failed:", squashAtomCommandFailure(inited));
        return { reason: "SKYCOT couldn't start tracking changes in this folder." };
      }
      const committed = await commitAll({
        actionId: randomUUID(),
        action: "commit",
        commitMessage: PRIVATE_COPY_COPY.firstVersion(project.title),
      });
      if (committed._tag === "Failure") {
        console.warn("[skycot] first commit failed:", squashAtomCommandFailure(committed));
        return { reason: plainPrivateCopyProblem(squashAtomCommandFailure(committed)) };
      }
      const again = await refreshStatus({ environmentId, input: { cwd } });
      if (again._tag === "Failure")
        return { reason: "SKYCOT couldn't read this folder's history." };
      readiness = folderReadiness(again.value);
    }
    if (readiness.kind !== "ready") {
      return { reason: "This folder isn't on a named branch right now." };
    }
    return { baseBranch: readiness.baseBranch };
  };

  const send = async (cleared: Extract<ShieldOutcome, { kind: "send" }>): Promise<SendOutcome> => {
    if (!ready || trimmed.length === 0 || modelSelection === null) return { kind: "cancelled" };
    const runtimeMode = runtimeModeFor(autonomy, provider);
    const createdAt = new Date().toISOString();
    // The id the shield minted: a grown-up's "as typed" was recorded against this message.
    const message = {
      messageId: cleared.messageId,
      role: "user",
      // The card's technical rules ride as a hidden marker; the child's words stay as typed.
      text: starterMessageText(cleared.text, seed),
      attachments: pictures.uploads(),
    } as const;
    const labels = firstMessageLabels(cleared.text, randomUUID(), family.enabled);
    // Just ask: find or make the Questions space (with the Family profile on, the engine
    // answers with the space of the child using SKYCOT here); the engine gives this question
    // its own folder inside it, so there is no private copy to make and nothing to set up.
    let destination = project;
    if (destination === null) {
      const opened = await openScratch({ environmentId, input: {} });
      if (opened._tag === "Failure") {
        console.warn("[skycot] opening Questions failed:", squashAtomCommandFailure(opened));
        return { kind: "failed", message: "SKYCOT couldn't open Questions just now. Try again." };
      }
      destination = opened.value;
    }
    const folder =
      project === null ? ({ question: true } as const) : await prepareFolder(destination);
    if ("cancelled" in folder) {
      setPhase(null);
      return { kind: "cancelled" };
    }
    const privateCopy =
      "baseBranch" in folder ? { baseBranch: folder.baseBranch, branch: labels.branch } : null;

    const start = (threadId: ThreadId, worktree: typeof privateCopy) =>
      startTurn({
        environmentId,
        input: {
          threadId,
          message,
          modelSelection,
          titleSeed: labels.title,
          runtimeMode,
          interactionMode,
          createdAt,
          bootstrap: {
            createThread: {
              projectId: destination.id,
              // The engine requires a non-empty title; the server regenerates a better one later.
              title: labels.title,
              modelSelection,
              runtimeMode,
              interactionMode,
              branch: worktree?.baseBranch ?? null,
              worktreePath: null,
              createdAt,
            },
            ...(worktree
              ? {
                  prepareWorktree: {
                    projectCwd: cwd,
                    baseBranch: worktree.baseBranch,
                    branch: worktree.branch,
                    requireWorktree: true,
                  },
                }
              : {}),
            runSetupScript: true,
          },
        },
      });

    let threadId = newThreadId();
    setPhase(privateCopy ? PRIVATE_COPY_COPY.makingCopy : null);
    let started = await start(threadId, privateCopy);
    let note = "reason" in folder ? folder.reason : null;
    if (started._tag === "Failure" && privateCopy) {
      // The copy couldn't be made (an empty repository, a clashing branch…):
      // still start the conversation, straight in the folder, and say so.
      const cause = squashAtomCommandFailure(started);
      console.warn("[skycot] private copy failed, starting in the folder instead:", cause);
      await deleteThread({ environmentId, input: { threadId } });
      note = plainPrivateCopyProblem(cause);
      threadId = newThreadId();
      setPhase(null);
      started = await start(threadId, null);
    }
    if (started._tag === "Failure") {
      await deleteThread({ environmentId, input: { threadId } });
      return {
        kind: "failed",
        message: calm(squashAtomCommandFailure(started), childView, crew.builder.name),
      };
    }
    if (note !== null) rememberStartNote(threadId, `${note} ${PRIVATE_COPY_COPY.undoOff}`);
    // Family with siblings: list it under this child's conversations straight away.
    noteStartedHere(threadId);
    writeLastProject({ environmentId, projectId: destination.id });
    navigate(threadHref(environmentId, threadId));
    return { kind: "started" };
  };

  // The shield first, before "Starting…": the card waits for the child, the field stays theirs.
  const sendCleared = async () => {
    if (!ready || trimmed.length === 0) return;
    const cleared = await shield.clear(
      trimmed,
      pictures.pictures.map((picture) => picture.dataUrl),
    );
    if (cleared.kind === "edit") {
      if (cleared.dropPictures) pictures.clear();
      return;
    }
    await onSend(async () => {
      const outcome = await send(cleared);
      if (outcome.kind === "started") pictures.clear();
      return outcome;
    });
  };

  const placeholder = !connected
    ? "Waiting for your Mac to reconnect…"
    : !canOperate
      ? "This connection can read conversations but not start them"
      : modelSelection === null
        ? "No assistant is set up yet — connect one in Settings → AI assistants"
        : project === null
          ? JUST_ASK_COPY.placeholder
          : `Say what you'd like done in ${project.title}…`;

  return (
    <>
      {pictures.problem ? (
        <div style={{ marginBottom: 10 }}>
          <Banner tone="warning">{pictures.problem}</Banner>
        </div>
      ) : wantsPicture && pictures.pictures.length === 0 ? (
        <p className="fm-help fm-composer__hint">
          Add a photo of your drawing with the <b>+</b> button, then press Send.
        </p>
      ) : null}
      {shield.card}
      <MessageField
        inputRef={inputRef}
        value={text}
        onChange={onText}
        pictures={pictures.pictures}
        onAddPictures={pictures.add}
        onRemovePicture={pictures.remove}
        onSend={() => void sendCleared()}
        canSend={ready && trimmed.length > 0 && !sending}
        disabled={!ready || sending}
        placeholder={placeholder}
        label="New conversation"
        starterBlanks={childView && seed !== null && stillFromStarter(seed.text, text)}
        foot={{
          left: childView ? null : phone ? (
            <>
              {project === null
                ? JUST_ASK_COPY.footPhone
                : `Starts a new conversation in ${project.title}`}
            </>
          ) : (
            <>
              {project === null
                ? JUST_ASK_COPY.foot
                : `Starts a new conversation in ${project.title}`}{" "}
              {childView ? null : (
                <>
                  · <Kbd>⇧</Kbd>
                  <Kbd>Return</Kbd> for a new line
                </>
              )}
            </>
          ),
          right: childView
            ? ""
            : sending
              ? (phase ?? "Starting…")
              : provider
                ? `Using ${catalogEntryFor(String(provider.driver)).brand}`
                : "",
        }}
      />
      {tracking && project ? (
        <TrackingSheet projectTitle={project.title} onChoose={tracking.resolve} />
      ) : null}
    </>
  );
}

function calm(error: unknown, childView = false, builder = "Sam"): string {
  const message = error instanceof Error ? error.message : String(error);
  // The screen stays plain-language; the real cause goes to the console for whoever debugs.
  console.warn("[skycot] starting a conversation failed:", error);
  if (/scope|permission|not allowed|unauthori/i.test(message)) {
    return "This connection isn't allowed to start conversations.";
  }
  return childView
    ? `${builder} couldn't start. Try again, or ask a grown-up.`
    : "Crew couldn't start just now. Check your Mac is awake and try again.";
}
