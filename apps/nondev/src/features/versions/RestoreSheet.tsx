import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import type { VersionEntry } from "../../plain/versions";
import { threadEnvironment } from "../../state/threads";
import { reportBadgeEvent } from "../badges/store";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { formatVersionTime, restoreSentence } from "./timeline";
import { useChildView } from "../../app/useChildView";

export type RestoreIntent = "undo" | "restore";

/**
 * The one confirmation for every rollback: "Undo all of it" on a What-changed
 * card and "Restore" in the Versions rail. Destructive, nothing pre-selected,
 * and it says what will and won't happen before the button is pressed.
 */
export function RestoreSheet({
  open,
  onClose,
  entry,
  intent,
  environmentId,
  threadId,
  versionNumber,
  onRequested,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly entry: VersionEntry | null;
  readonly intent: RestoreIntent;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly versionNumber?: number | null;
  /** Called once the engine accepted the request (the files change a moment later). */
  readonly onRequested?: () => void;
}) {
  const revert = useAtomCommand(threadEnvironment.revertCheckpoint, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const childView = useChildView();

  if (!entry) return null;
  const explainer = entry.restoreExplainer;
  const does = childView
    ? [
        "Puts the page back how it was before this change.",
        "Sam will forget messages after that point.",
      ]
    : explainer.does;
  const doesNot = childView
    ? ["Things already shared stay shared.", "This can't be undone."]
    : explainer.doesNot;
  const title = childView
    ? "Go back?"
    : intent === "undo"
      ? "Undo all of it?"
      : versionNumber
        ? `Restore Version ${versionNumber}?`
        : "Restore this version?";
  const verb = childView ? "Go back" : intent === "undo" ? "Undo all of it" : "Restore";

  const confirm = async () => {
    if (!entry.restore) return;
    setBusy(true);
    setProblem(null);
    const outcome = await revert({
      environmentId,
      input: {
        threadId,
        checkpointId: entry.restore.checkpointId,
        scopeId: entry.restore.scopeId,
        restoreFiles: entry.restore.restoreFiles,
      },
    });
    setBusy(false);
    if (outcome._tag === "Failure") {
      setProblem(plainRestoreProblem(squashAtomCommandFailure(outcome)));
      return;
    }
    void reportBadgeEvent({ type: "undo", threadId });
    onRequested?.();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      icon={RotateCcw}
      iconTone="red"
      sober
      description={
        childView
          ? "Put the page back to how it was before this change? You can't undo this."
          : restoreSentence(intent, versionNumber, formatVersionTime(entry.timestamp))
      }
      // A stray click outside must not cancel (or confirm) a destructive step.
      dismissOnBackdrop={false}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            filled
            disabled={busy || !entry.canRestore}
            onClick={() => void confirm()}
          >
            {busy ? `${intent === "undo" ? "Undoing" : "Restoring"}…` : verb}
          </Button>
        </>
      }
      note={
        childView
          ? undefined
          : `Back to: ${versionNumber ? `Version ${versionNumber} · ` : ""}${entry.label}`
      }
    >
      {problem ? <Banner tone="danger">{problem}</Banner> : null}
      {explainer.blockedBecause ? <Banner tone="warning">{explainer.blockedBecause}</Banner> : null}
      <div className="fm-restore-explainer">
        <ul className="fm-restore-explainer__list" aria-label="Restore does">
          {does.map((line) => (
            <li key={line}>
              <Check
                size={13}
                strokeWidth={2.4}
                aria-hidden
                className="fm-restore-explainer__yes"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <ul className="fm-restore-explainer__list" aria-label="Restore does not">
          {doesNot.map((line) => (
            <li key={line}>
              <X size={13} strokeWidth={2.4} aria-hidden className="fm-restore-explainer__no" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/** The engine's reasons, in household English. Never a raw error string. */
export function plainRestoreProblem(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/isolated worktree|shared/i.test(message))
    return "This project folder is shared with other work, so files can't be rolled back here.";
  if (/stale|missing|unavailable|cannot be restored/i.test(message))
    return "That restore point is no longer available, so nothing was changed.";
  if (/interrupt|running|active/i.test(message))
    return "Wait for the current work to finish (or stop it) before restoring.";
  if (/scope|permission|unauthori/i.test(message))
    return "This connection isn't allowed to restore versions.";
  return "That didn't work — nothing was changed. Check your Mac is awake and try again.";
}
