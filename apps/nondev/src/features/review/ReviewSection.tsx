import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  Cog,
  FileText,
  Image,
  MessageSquarePlus,
  Palette,
  Play,
  Receipt,
  Settings2,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useEffectEvent, useId, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  describeChanges,
  describeTurnDiff,
  fromCheckpointFiles,
  type ChangeArea,
  type WhatChanged,
} from "../../plain/changes";
import { keepCommitMessage, planGitIntent } from "../../plain/git";
import { describeCheckpoint } from "../../plain/versions";
import { copy } from "../../plain";
import { projectAtomOrEmpty } from "../../state/projects";
import { canOperateEnvironmentAtom } from "../../state/session";
import { orchestrationEnvironment, vcsActionManager, vcsEnvironment } from "../../state/vcs";
import { environmentThreads } from "../../state/threads";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../ui/Card";
import { List, ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { StepBadge } from "../../ui/StepBadge";
import { previewablePage } from "../starters/preview";
import { useOpenIt } from "../starters/PreviewSheet";
import { RestoreSheet, plainRestoreProblem } from "../versions/RestoreSheet";
import { formatVersionTime, useVersionsTimeline, type NumberedVersion } from "../versions/timeline";
import { useLastUpload } from "../publish/uploads";
import { rememberKeptVersion, useKeptVersions } from "./keptVersions";
import { reviewTargetFor } from "./turnReview";
import { useConversationShell } from "../../state/oldConversations";

const CodeChanges = lazy(() => import("./CodeChanges"));

const AREA_ICON: Record<ChangeArea, LucideIcon> = {
  pages: FileText,
  styles: Palette,
  content: Image,
  settings: Settings2,
  "behind the scenes": Cog,
};

/**
 * The "What changed" card at the end of a completed turn: plain summary,
 * per-area lines, calm flags, the real diff behind a disclosure, and the three
 * decisions — Keep (git commit), Undo (checkpoint rollback), Ask for a tweak.
 *
 * Standalone: it subscribes to the thread itself, so it can be mounted anywhere
 * with just `{ environmentId, threadId }`; without `checkpointId` it reviews the
 * newest turn that changed files. The stream mounts one per checkpoint (see
 * registerCheckpoint.tsx). Before/after pictures appear only when the engine
 * supplies them, which it does not yet — so nothing is shown in their place.
 */
export function ReviewSection({
  environmentId,
  threadId,
  checkpointId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly checkpointId?: string;
}) {
  const result = useAtomValue(environmentThreads.stateAtom(environmentId, threadId));
  // Put-away conversations too: their private copy is still theirs.
  const { shell } = useConversationShell(environmentId, threadId);
  const project = useAtomValue(projectAtomOrEmpty({ environmentId, projectId: shell?.projectId }));
  const canOperate = useAtomValue(canOperateEnvironmentAtom(environmentId));
  const state = Option.getOrNull(AsyncResult.value(result));
  const projection = state ? Option.getOrNull(state.data) : null;
  const target = projection ? reviewTargetFor(projection, threadId, checkpointId) : null;

  const timeline = useVersionsTimeline(environmentId, threadId, shell);
  const kept = useKeptVersions(threadId);
  const lastUpload = useLastUpload(threadId);

  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const gitStatus = useEnvironmentQuery(
    cwd === null ? null : vcsEnvironment.status({ environmentId, input: { cwd } }),
  );
  const runKeep = useAtomCommand(vcsActionManager.runStackedAction({ environmentId, cwd }), {
    reportFailure: false,
  });
  // The folder's status can be stale when a card mounts (a stash, a commit made
  // in Terminal); ask once so "Keep" is only offered when there is something.
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const refreshOnMount = useEffectEvent(() => {
    if (cwd !== null) void refreshStatus({ environmentId, input: { cwd } });
  });
  useEffect(() => {
    refreshOnMount();
  }, []);

  const [showCode, setShowCode] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [keepNote, setKeepNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const openIt = useOpenIt(environmentId);
  const [undoRequested, setUndoRequested] = useState(false);
  const undoNoteId = useId();

  // The turn's diff loads with the card: the engine's checkpoint summary calls
  // every file "modified", so only the diff can tell a new page from an edit.
  const diffInput = target?.diffInput ?? null;
  const diff = useEnvironmentQuery(
    diffInput !== null
      ? orchestrationEnvironment.turnDiff({ environmentId, input: diffInput })
      : null,
  );

  if (!projection || !target) return null;
  const { checkpoint, run, before } = target;
  const fromDiff = diff.data ? describeTurnDiff(diff.data.diff) : null;
  // A retry's own summary is empty; its card exists only when the span's diff has files.
  if (checkpoint.files.length === 0 && (fromDiff === null || fromDiff.counts.files === 0)) {
    return null;
  }

  const what: WhatChanged =
    fromDiff && fromDiff.counts.files > 0
      ? fromDiff
      : describeChanges(fromCheckpointFiles(checkpoint.files));
  const versionNumber = timeline.numbers.get(checkpoint.id) ?? null;
  const when = formatVersionTime(DateTime.formatIso(checkpoint.capturedAt));
  const keptHere = kept.find((entry) => entry.checkpointId === checkpoint.id) ?? null;
  const uploadedHere =
    keptHere !== null &&
    lastUpload !== null &&
    Date.parse(lastUpload.at) >= Date.parse(keptHere.at);
  const active = shell ? threadRuntimeIsActive(shell.runtime) : false;

  if (run?.status === "rolled_back") {
    // Files roll back; a kept commit never does. Say which happened.
    const keptNote = keptHere
      ? ` The files are back to how they were, but this version is still saved as Git commit ${keptHere.sha.slice(0, 7)}${uploadedHere ? " and on the online copy" : ""}. Publishing now would send the reversal.`
      : " Everything is back to how it was before this change.";
    return (
      <div className="fm-review" data-checkpoint-id={checkpoint.id}>
        <Card label="What changed (undone)" tinted>
          <CardHeader
            icon={Undo2}
            tone="grey"
            title="Undone"
            subtitle={`${what.summary}${keptNote}`}
          />
        </Card>
      </div>
    );
  }

  const filePaths = what.groups.flatMap((group) => group.files.map((file) => file.path));
  // A page this turn made or changed can be opened right here (starters make one file).
  const page =
    cwd === null || !shell?.projectId
      ? null
      : previewablePage(what.groups.flatMap((group) => group.files));
  // The commit reads like the request that caused it ("Make the button bigger…"),
  // with the plain summary underneath; git shows the first line in every log.
  const request = projection.messages.find(
    (message) => message.role === "user" && message.runId === checkpoint.runId,
  )?.text;
  const { subject: commitSubject, message: commitMessage } = keepCommitMessage(
    request,
    what.summary,
  );
  const plan = planGitIntent("keepThisVersion", {
    cwd: cwd ?? "",
    currentBranch: gitStatus.data?.refName ?? shell?.branch ?? null,
    defaultBranch: null,
    hasRemote: gitStatus.data?.hasPrimaryRemote ?? false,
    // Until the folder's status arrives, assume there is something to keep: the engine
    // answers "nothing new" itself if not.
    hasUncommittedChanges: gitStatus.data?.hasWorkingTreeChanges ?? true,
    commitMessage,
    filePaths,
  });
  const nothingToKeep = gitStatus.data != null && gitStatus.data.hasWorkingTreeChanges === false;
  const keepBlocked = keptHere !== null || plan.kind !== "stacked" || cwd === null || !canOperate;

  // The timeline's view of "before" carries the truthful blockers (undone,
  // or a kept version in between); a hidden empty point falls back to the
  // plain description.
  const beforeEntry: NumberedVersion | null = before
    ? (timeline.byId.get(before.id) ?? {
        ...describeCheckpoint(before, { canRollbackFiles: timeline.canRollbackFiles }, false),
        number: null,
        kept: null,
        undone: false,
      })
    : null;
  const undoBlocker = !canOperate
    ? "This connection can read but not change things."
    : beforeEntry === null
      ? "There's no restore point from before this change."
      : active
        ? "Wait for the current work to finish before undoing."
        : keptHere !== null
          ? `This version was kept as a Git commit${uploadedHere ? " and uploaded" : ""}, so it can't be rolled back from here. Ask the Crew to undo it instead — that makes a new version reversing it.`
          : (beforeEntry.restoreExplainer.blockedBecause ?? null);
  const canUndo = beforeEntry !== null && beforeEntry.canRestore && undoBlocker === null;
  const rollbackFailure = projection.thread.rollbackFailure ?? null;

  const keep = async () => {
    if (keepBlocked || plan.kind !== "stacked") return;
    setKeeping(true);
    setProblem(null);
    setKeepNote(null);
    const outcome = await runKeep({
      actionId: randomUUID(),
      action: "commit",
      commitMessage,
      ...(filePaths.length > 0 ? { filePaths } : {}),
      threadId,
    });
    setKeeping(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      const message = cause instanceof Error ? cause.message : String(cause);
      // Git's "nothing to commit" is not a failure; it means it was already saved.
      if (
        /nothing to commit|no changes|did not match any file|pathspec|nothing added/i.test(message)
      ) {
        setKeepNote("Nothing new to keep — this was already saved.");
        return;
      }
      setProblem(plainGitProblem(cause));
      return;
    }
    const commit = outcome.value.commit;
    if (commit.status === "created" && commit.commitSha) {
      rememberKeptVersion(threadId, {
        sha: commit.commitSha,
        subject: (commit.subject ?? commitSubject).replace(/\.$/, ""),
        at: new Date().toISOString(),
        fileCount: what.counts.files,
        checkpointId: checkpoint.id,
      });
    } else {
      setKeepNote("Nothing new to keep — this was already saved.");
    }
  };

  const askForTweak = () => {
    const field = document.querySelector<HTMLTextAreaElement>(".fm-composer__textarea");
    if (!field) return;
    field.focus();
    field.scrollIntoView({ block: "nearest" });
  };

  const footerNote = keptHere
    ? `Kept${uploadedHere ? " and uploaded" : ""} · also a Git commit ${keptHere.sha.slice(0, 7)}`
    : (keepNote ??
      (nothingToKeep
        ? copy.git.nothingToKeep
        : plan.kind === "blocked"
          ? plan.reason
          : "Keeping doesn't make it live — that's the next step."));

  return (
    <div className="fm-review" data-checkpoint-id={checkpoint.id}>
      <Card label="What changed">
        <CardHeader
          icon={Receipt}
          tone="green"
          title={
            <span className="fm-marker-underline fm-marker-underline--green">What changed</span>
          }
          subtitle={[
            versionNumber ? `Version ${versionNumber}` : "Restore point",
            when,
            keptHere ? (uploadedHere ? "kept and uploaded" : "kept") : "nothing is live yet",
          ]
            .filter(Boolean)
            .join(" · ")}
          trailing={
            <Pill tone="ok" size="sm" dot={false}>
              {what.counts.files} {what.counts.files === 1 ? "file" : "files"}
            </Pill>
          }
        />
        <CardBody>
          <p>{what.summary}</p>
          {what.groups.map((group) => (
            <section key={group.area} className="fm-review__area" aria-label={group.label}>
              <h4 className="fm-review__area-title">
                {group.label}
                <OperationTags files={group.files} />
              </h4>
              <List plain label={`${group.label} changes`}>
                {group.files.map((file) => (
                  <ListRow
                    key={file.path}
                    leading={<StepBadge state="number" icon={AREA_ICON[group.area]} />}
                    title={fileTitle(file.line)}
                    subtitle={fileDetail(file)}
                    trailing={<OperationTag operation={file.operation} />}
                  />
                ))}
              </List>
            </section>
          ))}
          <List plain label="Not touched">
            <ListRow
              leading={<StepBadge state="ok" icon={ShieldCheck} />}
              title="Not touched"
              subtitle={what.untouched}
            />
          </List>
          {what.warnings.map((warning) => (
            <div key={warning} className="fm-review__flag">
              <Banner tone="warning">{warning}</Banner>
            </div>
          ))}
          <details
            className="fm-disclosure"
            open={showCode}
            onToggle={(event) => setShowCode(event.currentTarget.open)}
          >
            <summary>
              Show the code changes — {what.counts.files}{" "}
              {what.counts.files === 1 ? "file" : "files"}, +{what.counts.additions} −
              {what.counts.deletions} lines
            </summary>
            <p className="fm-disclosure__hint">
              Green lines were added, red lines removed. You don't need to read this — it's here for
              you or whoever reviews it.
            </p>
            {shell?.branch ? (
              <details className="fm-disclosure__advanced">
                <summary>Advanced</summary>
                On branch {shell.branch}.
              </details>
            ) : null}
            {showCode ? (
              diffInput === null ? (
                <p className="fm-disclosure__hint">
                  The engine didn't record which turn this was, so the line-by-line view isn't
                  available. The list above is still exact.
                </p>
              ) : diff.error ? (
                <Banner tone="warning">
                  Couldn't load the code changes just now. The list above is still exact.
                </Banner>
              ) : diff.data === null ? (
                <p className="fm-disclosure__hint">Loading the code changes…</p>
              ) : (
                <Suspense
                  fallback={<p className="fm-disclosure__hint">Preparing the code view…</p>}
                >
                  <CodeChanges diff={diff.data.diff} scope={`review:${checkpoint.id}`} />
                </Suspense>
              )
            ) : null}
          </details>
          {problem && !keepBlocked ? (
            <div className="fm-review__flag">
              <Banner tone="danger">{problem}</Banner>
            </div>
          ) : null}
          {undoRequested && rollbackFailure ? (
            <div className="fm-review__flag">
              <Banner tone="danger">
                {plainRestoreProblem(new Error(rollbackFailure.message))}
              </Banner>
            </div>
          ) : null}
        </CardBody>
        <CardFooter note={footerNote}>
          {page !== null ? (
            <Button
              variant="primary"
              icon={Play}
              onClick={() =>
                shell?.projectId && openIt.openIt({ threadId, projectId: shell.projectId, page })
              }
            >
              Open it
            </Button>
          ) : null}
          <Button
            variant={page !== null ? "secondary" : "primary"}
            disabled={keepBlocked || keeping || nothingToKeep}
            onClick={() => void keep()}
          >
            {keeping ? "Keeping…" : keptHere ? "Kept" : "Keep these changes"}
          </Button>
          <Button
            variant="destructive"
            icon={Undo2}
            aria-disabled={!canUndo}
            aria-describedby={!canUndo && undoBlocker ? undoNoteId : undefined}
            onClick={() => {
              if (canUndo) setUndoOpen(true);
            }}
          >
            Undo all of it
          </Button>
          <Button icon={MessageSquarePlus} onClick={askForTweak}>
            Ask for a tweak
          </Button>
        </CardFooter>
        {undoBlocker && !canUndo ? (
          <p id={undoNoteId} className="fm-review__footnote">
            {undoBlocker}
          </p>
        ) : null}
      </Card>
      {openIt.sheet}
      <RestoreSheet
        open={undoOpen}
        onClose={() => setUndoOpen(false)}
        entry={beforeEntry}
        intent="undo"
        environmentId={environmentId}
        threadId={threadId}
        versionNumber={beforeEntry?.number ?? null}
        onRequested={() => setUndoRequested(true)}
      />
    </div>
  );
}

function OperationTags({ files }: { readonly files: WhatChanged["groups"][number]["files"] }) {
  const counts = { added: 0, edited: 0, deleted: 0, renamed: 0 };
  for (const file of files) counts[file.operation] += 1;
  const tags: Array<{ readonly label: string; readonly tone: "new" | "changed" | "removed" }> = [];
  if (counts.added > 0) tags.push({ label: tagLabel("New", counts.added), tone: "new" });
  if (counts.edited + counts.renamed > 0)
    tags.push({ label: tagLabel("Changed", counts.edited + counts.renamed), tone: "changed" });
  if (counts.deleted > 0)
    tags.push({ label: tagLabel("Removed", counts.deleted), tone: "removed" });
  return (
    <span className="fm-tags">
      {tags.map((tag) => (
        <span key={tag.tone} className={`fm-tag fm-tag--${tag.tone}`}>
          {tag.label}
        </span>
      ))}
    </span>
  );
}

function tagLabel(label: string, count: number): string {
  return count > 1 ? `${label} ×${count}` : label;
}

const OPERATION_TAG: Record<
  WhatChanged["groups"][number]["files"][number]["operation"],
  { readonly label: string; readonly tone: "new" | "changed" | "removed" }
> = {
  added: { label: "New", tone: "new" },
  edited: { label: "Changed", tone: "changed" },
  renamed: { label: "Moved", tone: "changed" },
  deleted: { label: "Removed", tone: "removed" },
};

function OperationTag({ operation }: { readonly operation: keyof typeof OPERATION_TAG }) {
  const tag = OPERATION_TAG[operation];
  return <span className={`fm-tag fm-tag--${tag.tone}`}>{tag.label}</span>;
}

/** "Edited the book page (+1 / −1 lines)" → "The book page". */
function fileTitle(line: string): string {
  const noun = line
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/^(added|edited|deleted|removed|renamed|moved|changed)\s+/i, "")
    .trim();
  return noun.length === 0 ? line : noun[0]!.toUpperCase() + noun.slice(1);
}

function fileDetail(file: WhatChanged["groups"][number]["files"][number]): string {
  const counts =
    file.additions + file.deletions === 0 ? "" : `+${file.additions} / −${file.deletions} lines · `;
  return `${counts}${file.path}`;
}

/** Git's reasons in household English. Never a raw error string. */
function plainGitProblem(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/not_a_repository|not a git repository/i.test(message))
    return "This folder isn't set up to keep versions yet.";
  if (/scope|permission|unauthori/i.test(message))
    return "This connection isn't allowed to keep versions.";
  if (/unavailable|not connected/i.test(message))
    return "Can't reach your Mac right now. Nothing was lost — try again in a moment.";
  return "That didn't save. Nothing was lost — try again in a moment.";
}
