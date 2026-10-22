import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ServerConfig, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { AlertCircle, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { newThreadId, randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { CrewName } from "../../themes/CrewName";
import { navigate, threadHref } from "../../router";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import {
  readAutonomy,
  useLastProject,
  writeAutonomy,
  writeLastProject,
} from "../../state/preferences";
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
import { useConnected } from "../../app/useConnection";
import { catalogEntryFor } from "../settings/providerCatalog";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { FamilyAutonomyLock } from "../family/FamilyLock";
import { useFamily } from "../family/FamilyProvider";
import { describeAutonomyLevel, hardRulesStatement } from "../../plain/autonomy";
import {
  autonomyLabel,
  autonomyLevelOf,
  PLAIN_AUTONOMY_OPTIONS,
  plainAutonomyOrDefault,
  runtimeModeFor,
  type Autonomy,
} from "./autonomy";
import { firstBlank } from "../starters/starters";
import type { ComposerSeed } from "../starters/StarterCards";
import { useShield, type ShieldOutcome } from "../shield";
import { firstMessageLabels } from "./firstMessage";
import { MessageField } from "./MessageField";
import { usePictures } from "./usePictures";
import {
  folderReadiness,
  plainPrivateCopyProblem,
  PRIVATE_COPY_COPY,
  STARTER_GITIGNORE,
} from "./privateCopy";
import { rememberStartNote } from "./startNotes";
import { TrackingSheet, type TrackingChoice } from "./TrackingSheet";

/**
 * The Home compose box: project chip, autonomy choice, message. Sending creates
 * a thread in the chosen project inside its own private copy (a Git worktree,
 * which is what lets the engine undo and restore), starts the first turn and
 * opens it.
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
  // Plain surfaces offer only the levels that keep a safety promise; a stored
  // "hands-off" (from Advanced mode) shows as asking first. The Family profile
  // pins it to asking first.
  const [chosenAutonomy, setAutonomy] = useState<Autonomy>(() =>
    plainAutonomyOrDefault(readAutonomy()),
  );
  const autonomy: Autonomy = family.enabled ? "ask-first" : chosenAutonomy;
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

  const keyOf = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;
  // Nothing chosen, nothing remembered and several projects: ask, rather than
  // aim the first message at whichever project happens to be listed first.
  const project =
    projects.find((candidate) => keyOf(candidate) === (chosenKey ?? preferredProjectKey)) ??
    projects.find(
      (candidate) =>
        lastProject !== null &&
        candidate.environmentId === lastProject.environmentId &&
        candidate.id === lastProject.projectId,
    ) ??
    (projects.length === 1 ? projects[0]! : null);
  const phone = columns === 1;

  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        <div className="fm-composer__context">
          <Popover
            label="Project"
            trigger={
              <Button size="sm" disabled={projects.length === 0}>
                {project ? <ProjectAvatar project={project} size="sm" /> : null}
                {project
                  ? project.title
                  : projects.length === 0
                    ? connected
                      ? "No project yet"
                      : "Waiting for your Mac…"
                    : "Choose a project"}
                <ChevronDown size={12} strokeWidth={2} aria-hidden />
              </Button>
            }
          >
            {(close) =>
              projects.map((candidate) => (
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
                  {candidate.title}
                </MenuItem>
              ))
            }
          </Popover>
          {family.enabled ? (
            <FamilyAutonomyLock />
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
            </>
          )}
        </div>
        {/* One sentence for the chosen level, not a paragraph about every level. */}
        <p className="fm-help" style={{ marginBottom: 6 }}>
          <b>{autonomyLabel(autonomy)}.</b>{" "}
          {describeAutonomyLevel(autonomyLevelOf(autonomy), { policyEnforced })}
        </p>
        {!phone ? (
          <p className="fm-rule" style={{ marginBottom: 10 }}>
            <span className="fm-rule__icon">
              <AlertCircle size={14} strokeWidth={1.8} aria-hidden />
            </span>
            <span>{hardRulesStatement(policyEnforced, undefined, family.enabled)}</span>
          </p>
        ) : null}
        {problem ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="warning">{problem}</Banner>
          </div>
        ) : null}
        {project ? (
          <ComposerField
            project={project}
            autonomy={autonomy}
            text={text}
            onText={setText}
            sending={sending}
            connected={connected}
            phone={phone}
            inputRef={inputRef}
            wantsPicture={appliedSeed?.wantsPicture === true}
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
              projects.length === 0
                ? connected
                  ? "Open a folder in the sidebar first, then say what you'd like done"
                  : "Waiting for your Mac…"
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
  project,
  autonomy,
  text,
  onText,
  sending,
  connected,
  phone,
  inputRef,
  wantsPicture,
  onSend,
}: {
  readonly project: EnvironmentProject;
  readonly autonomy: Autonomy;
  readonly text: string;
  readonly onText: (value: string) => void;
  readonly sending: boolean;
  readonly connected: boolean;
  readonly phone: boolean;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  /** "Draw it, then build it": the box hints at the + button until a picture is added. */
  readonly wantsPicture: boolean;
  readonly onSend: (send: () => Promise<SendOutcome>) => Promise<void>;
}) {
  const environmentId = project.environmentId;
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const modelSelection = resolveDefaultModelSelection(providers, project);
  const provider = providerForSelection(providers, modelSelection);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const cwd = project.workspaceRoot;
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
  const prepareFolder = async (): Promise<
    { readonly baseBranch: string } | { readonly reason: string } | { readonly cancelled: true }
  > => {
    const first = await refreshStatus({ environmentId, input: { cwd } });
    if (first._tag === "Failure") {
      console.warn("[skycot] git status failed:", squashAtomCommandFailure(first));
      return { reason: "SKYCOT couldn't read this folder's history." };
    }
    let readiness = folderReadiness(first.value);
    if (readiness.kind === "needs-init") {
      const choice = await askTracking();
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
      text: cleared.text,
      attachments: pictures.uploads(),
    } as const;
    const labels = firstMessageLabels(cleared.text, randomUUID(), family.enabled);
    const folder = await prepareFolder();
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
          interactionMode: "default",
          createdAt,
          bootstrap: {
            createThread: {
              projectId: project.id,
              // The engine requires a non-empty title; the server regenerates a better one later.
              title: labels.title,
              modelSelection,
              runtimeMode,
              interactionMode: "default",
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
    let note = "baseBranch" in folder ? null : folder.reason;
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
      return { kind: "failed", message: calm(squashAtomCommandFailure(started)) };
    }
    if (note !== null) rememberStartNote(threadId, `${note} ${PRIVATE_COPY_COPY.undoOff}`);
    writeLastProject({ environmentId, projectId: project.id });
    navigate(threadHref(environmentId, threadId));
    return { kind: "started" };
  };

  // The shield first, before "Starting…": the card waits for the child, the field stays theirs.
  const sendCleared = async () => {
    if (!ready || trimmed.length === 0) return;
    const cleared = await shield.clear(trimmed, pictures.pictures.length);
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
        foot={{
          left: phone ? (
            <>Starts a new conversation in {project.title}</>
          ) : (
            <>
              Starts a new conversation in {project.title} · <Kbd>⇧</Kbd>
              <Kbd>Return</Kbd> for a new line
            </>
          ),
          right: sending
            ? (phase ?? "Starting…")
            : provider
              ? `Using ${catalogEntryFor(String(provider.driver)).brand}`
              : "",
        }}
      />
      {tracking ? <TrackingSheet projectTitle={project.title} onChoose={tracking.resolve} /> : null}
    </>
  );
}

function calm(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The screen stays plain-language; the real cause goes to the console for whoever debugs.
  console.warn("[skycot] starting a conversation failed:", error);
  if (/scope|permission|not allowed|unauthori/i.test(message)) {
    return "This connection isn't allowed to start conversations.";
  }
  return "Crew couldn't start just now. Check your Mac is awake and try again.";
}
