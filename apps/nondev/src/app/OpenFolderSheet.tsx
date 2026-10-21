import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  canNavigateUp,
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { ArrowUp, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";

import { newProjectId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { filesystemEnvironment } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { serverEnvironment } from "../state/server";
import { Banner } from "../ui/Banner";
import { Button, IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { List, ListRow } from "../ui/ListRow";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";

/**
 * "Open a folder…": browse the Mac's folders through the engine (the browser
 * itself cannot see the disk) and register the chosen one as a project.
 */
export function OpenFolderSheet({
  open,
  onClose,
  environmentId,
  onOpened,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly onOpened?: (projectId: string) => void;
}) {
  return open ? (
    <OpenFolderSheetBody
      environmentId={environmentId}
      onClose={onClose}
      {...(onOpened ? { onOpened } : {})}
    />
  ) : null;
}

function OpenFolderSheetBody({
  environmentId,
  onClose,
  onOpened,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onOpened?: (projectId: string) => void;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  // The engine's working folder always exists; newProjectsRoot often does not yet.
  const startPath = config?.cwd ?? "/";
  const [path, setPath] = useState(() => ensureBrowseDirectoryPath(startPath));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  const browse = useAtomValue(
    filesystemEnvironment.browse({ environmentId, input: { partialPath: path } }),
  );
  const result = Option.getOrNull(AsyncResult.value(browse));
  const browseFailed = browse._tag === "Failure";
  const folderName = inferProjectTitleFromPath(path);

  const choose = async () => {
    setBusy(true);
    setProblem(null);
    const trimmed = title.trim();
    const projectId = newProjectId();
    const outcome = await createProject({
      environmentId,
      input: {
        projectId,
        title: trimmed.length > 0 ? trimmed : folderName,
        workspaceRoot: path.replace(/[\\/]+$/, "") || path,
      },
    });
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      setProblem(
        cause instanceof Error && /exist/i.test(cause.message)
          ? "That folder is already one of your projects."
          : "That folder couldn't be opened as a project. Try another one.",
      );
      return;
    }
    onOpened?.(projectId);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={FolderOpen}
      title="Open a folder as a project"
      description="Pick the folder on your Mac that holds the website or app. Crew only ever works inside it."
      wide
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void choose()} disabled={busy}>
            {busy ? "Opening…" : `Open “${folderName}”`}
          </Button>
        </>
      }
    >
      <div className="fm-browse">
        <div className="fm-browse__path">
          <IconButton
            icon={ArrowUp}
            label="Up one folder"
            size="sm"
            disabled={!canNavigateUp(path)}
            onClick={() => {
              const parent = getBrowseParentPath(path);
              if (parent !== null) setPath(ensureBrowseDirectoryPath(parent));
            }}
          />
          <span className="fm-browse__crumbs">{path}</span>
        </div>
        <div className="fm-browse__list">
          {browseFailed ? (
            <EmptyState icon={Folder} title="Can't look inside this folder">
              Your Mac didn't let us list it. Go up a level and try another.
            </EmptyState>
          ) : result === null ? (
            <EmptyState title="Looking…" />
          ) : result.entries.length === 0 ? (
            <EmptyState icon={Folder} title="No folders inside">
              You can still open this folder itself.
            </EmptyState>
          ) : (
            <List plain label="Folders">
              {result.entries.map((entry) => (
                <ListRow
                  key={entry.fullPath}
                  leading={<Folder size={16} strokeWidth={1.7} aria-hidden />}
                  title={entry.name}
                  chevron
                  onClick={() => setPath(ensureBrowseDirectoryPath(entry.fullPath))}
                />
              ))}
            </List>
          )}
        </div>
        <TextField
          label="Call it (optional)"
          placeholder={folderName}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          autoComplete="off"
        />
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
      </div>
    </Sheet>
  );
}
