import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import { AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

import { newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { CrewName } from "../../themes/CrewName";
import { navigate, threadHref } from "../../router";
import { environmentProjects } from "../../state/projects";
import {
  readAutonomy,
  useLastProject,
  writeAutonomy,
  writeLastProject,
} from "../../state/preferences";
import {
  providerDisplayName,
  providerForSelection,
  resolveDefaultModelSelection,
} from "../../state/providers";
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
import {
  ALWAYS_ASKS,
  AUTONOMY_EXPLAINER,
  AUTONOMY_OPTIONS,
  runtimeModeFor,
  type Autonomy,
} from "./autonomy";
import { MessageField } from "./MessageField";
import {
  branchNameFor,
  folderReadiness,
  plainPrivateCopyProblem,
  PRIVATE_COPY_COPY,
} from "./privateCopy";
import { rememberStartNote } from "./startNotes";

/**
 * The Home compose box: project chip, autonomy choice, message. Sending creates
 * a thread in the chosen project inside its own private copy (a Git worktree,
 * which is what lets the engine undo and restore), starts the first turn and
 * opens it.
 */
export function NewConversationComposer({
  preferredProjectKey,
}: {
  /** `${environmentId}:${projectId}` from the sidebar selection, when any. */
  readonly preferredProjectKey: string | null;
}) {
  const projects = useAtomValue(environmentProjects.projectsAtom);
  const lastProject = useLastProject();
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy>(readAutonomy);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const keyOf = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;
  const project =
    projects.find((candidate) => keyOf(candidate) === (chosenKey ?? preferredProjectKey)) ??
    projects.find(
      (candidate) =>
        lastProject !== null &&
        candidate.environmentId === lastProject.environmentId &&
        candidate.id === lastProject.projectId,
    ) ??
    projects[0] ??
    null;

  return (
    <div className="fm-composer">
      <div className="fm-composer__inner">
        <div className="fm-composer__context">
          <Popover
            label="Project"
            trigger={
              <Button size="sm" disabled={projects.length === 0}>
                {project ? <ProjectAvatar project={project} size="sm" /> : null}
                {project ? project.title : "No project yet"}
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
                    close();
                  }}
                >
                  {candidate.title}
                </MenuItem>
              ))
            }
          </Popover>
          <span className="fm-composer__label">
            How much should <CrewName /> do on its own?
          </span>
          <SegmentedControl
            label="Autonomy"
            size="sm"
            value={autonomy}
            onChange={(next) => {
              setAutonomy(next);
              writeAutonomy(next);
            }}
            options={AUTONOMY_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              ...(option.tag ? { tag: option.tag } : {}),
            }))}
          />
        </div>
        <p className="fm-help" style={{ marginBottom: 6 }}>
          {AUTONOMY_EXPLAINER}
        </p>
        <p className="fm-rule" style={{ marginBottom: 10 }}>
          <span className="fm-rule__icon">
            <AlertCircle size={14} strokeWidth={1.8} aria-hidden />
          </span>
          <span>
            <b>Always asks, in every mode:</b> {ALWAYS_ASKS}
          </span>
        </p>
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
            onSend={async (send) => {
              setSending(true);
              setProblem(null);
              const outcome = await send();
              setSending(false);
              if (outcome !== null) setProblem(outcome);
              else setText("");
            }}
          />
        ) : (
          <MessageField
            value={text}
            onChange={setText}
            onSend={() => {}}
            canSend={false}
            disabled
            attach
            placeholder="Open a folder in the sidebar first, then say what you'd like done"
          />
        )}
      </div>
    </div>
  );
}

function ComposerField({
  project,
  autonomy,
  text,
  onText,
  sending,
  onSend,
}: {
  readonly project: EnvironmentProject;
  readonly autonomy: Autonomy;
  readonly text: string;
  readonly onText: (value: string) => void;
  readonly sending: boolean;
  readonly onSend: (send: () => Promise<string | null>) => Promise<void>;
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
  const commitAll = useAtomCommand(vcsActionManager.runStackedAction({ environmentId, cwd }), {
    reportFailure: false,
  });
  const [phase, setPhase] = useState<string | null>(null);

  const ready = canOperate && modelSelection !== null;
  const trimmed = text.trim();

  /**
   * The branch the private copy starts from, or the plain reason there can't
   * be one. A folder with no history gets `git init` and a first saved version
   * so there is something to copy.
   */
  const prepareFolder = async (): Promise<
    { readonly baseBranch: string } | { readonly reason: string }
  > => {
    const first = await refreshStatus({ environmentId, input: { cwd } });
    if (first._tag === "Failure") {
      console.warn("[skycot] git status failed:", squashAtomCommandFailure(first));
      return { reason: "SKYCOT couldn't read this folder's history." };
    }
    let readiness = folderReadiness(first.value);
    if (readiness.kind === "needs-init") {
      setPhase(PRIVATE_COPY_COPY.settingUp);
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

  const send = async (): Promise<string | null> => {
    if (!ready || trimmed.length === 0 || modelSelection === null) return null;
    const runtimeMode = runtimeModeFor(autonomy, provider);
    const createdAt = new Date().toISOString();
    const message = {
      messageId: newMessageId(),
      role: "user",
      text: trimmed,
      attachments: [],
    } as const;
    const folder = await prepareFolder();
    const privateCopy =
      "baseBranch" in folder
        ? { baseBranch: folder.baseBranch, branch: branchNameFor(trimmed, randomUUID()) }
        : null;

    const start = (threadId: ThreadId, worktree: typeof privateCopy) =>
      startTurn({
        environmentId,
        input: {
          threadId,
          message,
          modelSelection,
          titleSeed: trimmed,
          runtimeMode,
          interactionMode: "default",
          createdAt,
          bootstrap: {
            createThread: {
              projectId: project.id,
              // The engine requires a non-empty title; the server regenerates a better one later.
              title: titleSeedFrom(trimmed),
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
      return calm(squashAtomCommandFailure(started));
    }
    if (note !== null) rememberStartNote(threadId, `${note} ${PRIVATE_COPY_COPY.undoOff}`);
    writeLastProject({ environmentId, projectId: project.id });
    navigate(threadHref(environmentId, threadId));
    return null;
  };

  const placeholder = !canOperate
    ? "This connection can read conversations but not start them"
    : modelSelection === null
      ? "No assistant is set up yet — open Advanced mode to sign in to one"
      : `Say what you'd like done in ${project.title}…`;

  return (
    <MessageField
      value={text}
      onChange={onText}
      onSend={() => void onSend(send)}
      canSend={ready && trimmed.length > 0 && !sending}
      disabled={!ready || sending}
      attach
      placeholder={placeholder}
      label="New conversation"
      foot={{
        left: (
          <>
            Starts a new conversation in {project.title} · <Kbd>⇧</Kbd>
            <Kbd>Return</Kbd> for a new line
          </>
        ),
        right: sending
          ? (phase ?? "Starting…")
          : provider
            ? `Using ${providerDisplayName(provider)}`
            : "",
      }}
    />
  );
}

function titleSeedFrom(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "New conversation";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
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
