import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { FolderPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { newProjectId, randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { useShellState } from "../../app/ShellState";
import { projectEnvironment } from "../../state/projects";
import { vcsActionManager } from "../../state/vcs";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { TextField } from "../../ui/TextField";
import { showToast } from "../../ui/Toast";
import { PRIVATE_COPY_COPY } from "../compose/privateCopy";
import { JUST_ASK_COPY, projectNameFrom, suggestedProjectName } from "./questions";

const DIDNT_GO = "That didn't go through. Check your Mac is awake and try again.";

/**
 * "Make this a project": the question's own folder becomes a project with a name. Nothing is
 * moved or copied, so the conversation keeps working on the same files, with its Undo and
 * history, and is listed with the new project from now on. A first saved version is made so
 * the project's next conversations get their own private copies. Undo in the toast takes the
 * project off the list again (the files stay where they are).
 */
export function MakeProjectSheet({
  shell,
  title,
  onClose,
}: {
  /** Null keeps the sheet closed. */
  readonly shell: EnvironmentThreadShell | null;
  readonly title: string;
  readonly onClose: () => void;
}) {
  if (shell === null || shell.worktreePath === null) return null;
  return (
    <MakeProjectSheetBody
      shell={shell}
      folder={shell.worktreePath}
      title={title}
      onClose={onClose}
    />
  );
}

function MakeProjectSheetBody({
  shell,
  folder,
  title,
  onClose,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly folder: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const environmentId = shell.environmentId;
  const [value, setValue] = useState(() => suggestedProjectName(title));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const commitAll = useAtomCommand(
    vcsActionManager.runStackedAction({ environmentId, cwd: folder }),
    { reportFailure: false },
  );
  const listShell = useShellState();
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const name = projectNameFrom(value);

  const make = async () => {
    if (name === null) return;
    setBusy(true);
    setProblem(null);
    const projectId = newProjectId();
    const created = await createProject({
      environmentId,
      input: { projectId, title: name, workspaceRoot: folder },
    });
    if (created._tag === "Failure") {
      console.warn("[skycot] make this a project failed:", squashAtomCommandFailure(created));
      setBusy(false);
      setProblem(DIDNT_GO);
      return;
    }
    // Not fatal: without a first version the next conversation starts straight in the folder.
    const saved = await commitAll({
      actionId: randomUUID(),
      action: "commit",
      commitMessage: PRIVATE_COPY_COPY.firstVersion(name),
    });
    if (saved._tag === "Failure") {
      console.warn("[skycot] first version failed:", squashAtomCommandFailure(saved));
    }
    setBusy(false);
    onClose();
    const projectKey = `${environmentId}:${projectId}`;
    showToast(JUST_ASK_COPY.madeProject(name), {
      label: "Undo",
      run: async () => {
        const undone = await deleteProject({ environmentId, input: { projectId } });
        if (undone._tag === "Failure") showToast(DIDNT_GO);
        else if (listShell.projectKey === projectKey) listShell.setProjectKey(null);
      },
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={FolderPlus}
      title={JUST_ASK_COPY.makeProject}
      description="Give it a name. Everything made in this question stays, and you can keep working on it here or start new conversations in the project."
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void make()} disabled={busy || name === null}>
            {busy ? "Making it…" : "Make project"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        <TextField
          label="Project name"
          inputRef={inputRef}
          value={value}
          maxLength={60}
          autoComplete="off"
          spellCheck
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setProblem(null);
          }}
        />
      </form>
      {problem ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warning">{problem}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
