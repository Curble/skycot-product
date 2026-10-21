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
import { ArrowUp, Folder, FolderOpen, Laptop } from "lucide-react";
import { useRef, useState } from "react";

import { newProjectId } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { filesystemEnvironment } from "../state/filesystem";
import { readLastProject } from "../state/preferences";
import { environmentProjects, projectEnvironment } from "../state/projects";
import { serverEnvironment } from "../state/server";
import { Banner } from "../ui/Banner";
import { Button, IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { List, ListRow } from "../ui/ListRow";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import {
  defaultBrowseStart,
  folderCrumbs,
  folderGuard,
  homeDirectoryFrom,
  normalizeFolderPath,
  sameFolder,
  visibleEntries,
} from "./folders";
import { useConnected } from "./useConnection";

const LAST_BROWSE_KEY = "skycot:last-folder-browse";

function readLastBrowse(): string | null {
  try {
    return window.localStorage.getItem(LAST_BROWSE_KEY);
  } catch {
    return null;
  }
}
function writeLastBrowse(path: string) {
  try {
    window.localStorage.setItem(LAST_BROWSE_KEY, path);
  } catch {
    // Nothing to remember next time.
  }
}

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
  const projects = useAtomValue(environmentProjects.projectsAtom).filter(
    (project) => project.environmentId === environmentId,
  );
  const connected = useConnected();
  const [path, setPath] = useState(() => {
    const last = readLastProject();
    const lastProjectRoot =
      projects.find((project) => project.id === last?.projectId)?.workspaceRoot ?? null;
    return ensureBrowseDirectoryPath(
      defaultBrowseStart({
        remembered: readLastBrowse(),
        lastProjectRoot,
        cwd: config?.cwd ?? null,
      }),
    );
  });
  const [showHidden, setShowHidden] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const listRef = useRef<HTMLDivElement>(null);

  const browse = useAtomValue(
    filesystemEnvironment.browse({ environmentId, input: { partialPath: path } }),
  );
  const result = Option.getOrNull(AsyncResult.value(browse));
  const browseFailed = browse._tag === "Failure";
  const folderName = inferProjectTitleFromPath(path);
  const homeDir = homeDirectoryFrom(config?.cwd ?? path);
  const verdict = folderGuard(path, homeDir);
  const existing = projects.find((project) => sameFolder(project.workspaceRoot, path)) ?? null;
  const entries = result ? visibleEntries(result.entries, showHidden) : [];
  const hiddenCount = result
    ? result.entries.length - visibleEntries(result.entries, false).length
    : 0;

  const goTo = (next: string) => {
    // The clicked row is about to unmount, which would drop focus to <body>
    // (and with it, Escape and the Tab order); the list box takes focus first.
    listRef.current?.focus();
    setProblem(null);
    setPath(ensureBrowseDirectoryPath(next));
  };

  const choose = async () => {
    if (existing) {
      onOpened?.(existing.id);
      onClose();
      return;
    }
    setBusy(true);
    setProblem(null);
    const trimmed = title.trim();
    const projectId = newProjectId();
    const outcome = await createProject({
      environmentId,
      input: {
        projectId,
        title: trimmed.length > 0 ? trimmed : folderName,
        workspaceRoot: normalizeFolderPath(path) || path,
      },
    });
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      const message = describeFailure(cause);
      console.warn("[skycot] opening a folder failed:", cause);
      setProblem(
        /already exists/i.test(message)
          ? "That folder is already one of your projects."
          : /not allowed|scope|permission|unauthori/i.test(message)
            ? "This connection isn't allowed to add projects."
            : "That folder couldn't be opened as a project. Try another one.",
      );
      return;
    }
    writeLastBrowse(getBrowseParentPath(path) ?? path);
    onOpened?.(projectId);
    onClose();
  };

  const canOpen = connected && !busy && verdict.kind !== "refuse" && !browseFailed;
  const openLabel = existing
    ? `Show “${existing.title}”`
    : busy
      ? "Opening…"
      : `Open “${folderName}”`;
  const crumbs = folderCrumbs(path, homeDir);
  const crumbItems = crumbs.map((label, index) => ({
    label,
    id: crumbs.slice(0, index + 1).join("/"),
    first: index === 0,
  }));

  return (
    <Sheet
      open
      onClose={onClose}
      icon={FolderOpen}
      title="Open a folder as a project"
      description="Pick the folder that holds just this website or app — not your whole Documents or home folder. Crew only ever works inside it."
      wide
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void choose()} disabled={!canOpen}>
            {openLabel}
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
              if (parent !== null) goTo(parent);
            }}
          />
          <span className="fm-browse__crumbs">
            {crumbItems.map((crumb, index) => (
              <span
                key={crumb.id}
                className={`fm-browse__crumb${
                  index === crumbItems.length - 1 ? " fm-browse__crumb--last" : ""
                }`}
              >
                {!crumb.first ? (
                  <span className="fm-browse__sep" aria-hidden>
                    ›
                  </span>
                ) : null}
                {crumb.label}
              </span>
            ))}
          </span>
        </div>
        <div
          className="fm-browse__list"
          ref={listRef}
          tabIndex={-1}
          role="group"
          aria-label={`Folders inside ${crumbs[crumbs.length - 1] ?? "this folder"}`}
        >
          {!connected ? (
            <EmptyState icon={Laptop} title="Can't reach your Mac right now">
              Folders appear as soon as it's reachable again.
            </EmptyState>
          ) : browseFailed ? (
            <EmptyState icon={Folder} title="Can't look inside this folder">
              Your Mac didn't let us list it. Go up a level and try another.
            </EmptyState>
          ) : result === null ? (
            <EmptyState title="Looking…" />
          ) : entries.length === 0 ? (
            <EmptyState icon={Folder} title="No folders inside">
              {hiddenCount > 0 && !showHidden
                ? "Only hidden tool folders are in here. You can still open this folder itself."
                : "Files aren't listed here, only folders. You can still open this folder itself."}
            </EmptyState>
          ) : (
            <List plain label="Folders">
              {entries.map((entry) => (
                <ListRow
                  key={entry.fullPath}
                  leading={<Folder size={16} strokeWidth={1.7} aria-hidden />}
                  title={entry.name}
                  chevron
                  onClick={() => goTo(entry.fullPath)}
                />
              ))}
            </List>
          )}
        </div>
        <div className="fm-browse__tools">
          <label className="fm-browse__toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.currentTarget.checked)}
            />
            Show hidden folders{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
          </label>
        </div>
        {existing ? (
          <Banner tone="info">
            <b>Already one of your projects:</b> {existing.title}.
          </Banner>
        ) : verdict.kind === "refuse" ? (
          <Banner tone="warning">{verdict.reason}</Banner>
        ) : verdict.kind === "warn" ? (
          <Banner tone="info">{verdict.reason}</Banner>
        ) : null}
        {!existing && verdict.kind !== "refuse" ? (
          <TextField
            label="Call it (optional)"
            placeholder={folderName}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            autoComplete="off"
          />
        ) : null}
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
      </div>
    </Sheet>
  );
}

/** Every layer of a squashed failure as one searchable string. */
function describeFailure(cause: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.message === "string") parts.push(record.message);
      if (typeof record._tag === "string") parts.push(record._tag);
      if ("cause" in record) visit(record.cause, depth + 1);
      if ("error" in record) visit(record.error, depth + 1);
    }
  };
  visit(cause, 0);
  return parts.join(" | ");
}
