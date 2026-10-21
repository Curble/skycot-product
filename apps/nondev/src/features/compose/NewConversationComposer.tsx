import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

import { newMessageId, newThreadId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { CREW_NAME } from "../../brand";
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

/**
 * The Home compose box: project chip, autonomy choice, message. Sending creates
 * a thread in the chosen project, starts the first turn and opens it.
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
          <span className="fm-composer__label">How much should {CREW_NAME} do on its own?</span>
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
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  const ready = canOperate && modelSelection !== null;
  const trimmed = text.trim();

  const send = async (): Promise<string | null> => {
    if (!ready || trimmed.length === 0 || modelSelection === null) return null;
    const threadId = newThreadId();
    const runtimeMode = runtimeModeFor(autonomy, provider);
    const createdAt = new Date().toISOString();
    const created = await createThread({
      environmentId,
      input: {
        threadId,
        projectId: project.id,
        // The engine requires a non-empty title; the server regenerates a better one later.
        title: titleSeedFrom(trimmed),
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });
    if (created._tag === "Failure") return calm(squashAtomCommandFailure(created));
    const started = await startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: trimmed, attachments: [] },
        modelSelection,
        titleSeed: trimmed,
        runtimeMode,
        interactionMode: "default",
        createdAt,
      },
    });
    if (started._tag === "Failure") {
      await deleteThread({ environmentId, input: { threadId } });
      return calm(squashAtomCommandFailure(started));
    }
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
        right: sending ? "Starting…" : provider ? `Using ${providerDisplayName(provider)}` : "",
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
  console.warn("[foreman] starting a conversation failed:", error);
  if (/scope|permission|not allowed|unauthori/i.test(message)) {
    return "This connection isn't allowed to start conversations.";
  }
  return "Crew couldn't start just now. Check your Mac is awake and try again.";
}
