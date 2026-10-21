import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { versions as copy } from "../../plain/copy";
import { Button } from "../../ui/Button";
import { Pill, type PillTone } from "../../ui/Pill";
import { RestoreSheet } from "./RestoreSheet";
import {
  formatVersionTime,
  honestRestoreExplainer,
  useVersionsTimeline,
  type NumberedVersion,
} from "./timeline";

const KIND_TONE: Record<NumberedVersion["kind"], PillTone> = {
  "restore point": "neutral",
  "kept version": "ok",
  live: "working",
};

/**
 * The Time Machine column: every point you can step back to, newest first,
 * with a Restore button per point and the fixed does / does-not explainer.
 * Shared by the right-hand rail and the narrow-screen sheet.
 */
export function VersionsTimeline({
  environmentId,
  threadId,
  shell,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly shell: EnvironmentThreadShell | null;
  readonly canOperate: boolean;
}) {
  const timeline = useVersionsTimeline(environmentId, threadId, shell);
  const [restoring, setRestoring] = useState<NumberedVersion | null>(null);
  const active = shell ? threadRuntimeIsActive(shell.runtime) : false;
  const explainer = honestRestoreExplainer();

  return (
    <>
      {timeline.entries.length === 0 ? (
        <p className="fm-tm__empty">
          No versions yet. The first one appears when a change finishes.
        </p>
      ) : (
        <ol className="fm-tm" aria-label="Versions, newest first">
          {timeline.entries.map((entry) => {
            const blocker = !canOperate
              ? "This connection can read but not restore."
              : active
                ? "Wait for the current work to finish before restoring."
                : entry.isCurrent
                  ? "This is where the project is right now."
                  : (entry.restoreExplainer.blockedBecause ?? null);
            const canRestore = entry.canRestore && blocker === null;
            return (
              <li
                key={entry.id}
                className="fm-tm__v"
                data-kind={entry.kind}
                data-current={entry.isCurrent ? "true" : undefined}
              >
                <div className="fm-tm__text">
                  <span className="fm-tm__title">
                    {entry.number ? `Version ${entry.number}` : entry.label}
                  </span>
                  {entry.number ? <span className="fm-tm__label">{entry.label}</span> : null}
                  <span className="fm-tm__meta">
                    {formatVersionTime(entry.timestamp)}
                    {entry.isCurrent ? " · now" : ""}
                    {entry.restoreExplainer.blockedBecause === copy.cannotRestoreStale
                      ? " · undone"
                      : ""}
                    <Pill tone={KIND_TONE[entry.kind]} size="sm" dot={false}>
                      {entry.kindLabel}
                    </Pill>
                  </span>
                </div>
                {entry.kind === "restore point" ? (
                  <Button
                    size="sm"
                    disabled={!canRestore}
                    title={blocker ?? undefined}
                    aria-label={`Restore to ${entry.label}`}
                    onClick={() => setRestoring(entry)}
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {!timeline.canRollbackFiles && timeline.entries.length > 0 ? (
        <p className="fm-tm__note">
          Restoring is off for this conversation: it works straight in the project folder, which
          other work may share. Start a new conversation to get a private copy that can be rolled
          back.
        </p>
      ) : null}
      <div className="fm-tm__explainer">
        <p className="fm-tm__explainer-head">
          <Check size={12} strokeWidth={2.6} aria-hidden className="fm-restore-explainer__yes" />
          Restore does
        </p>
        <ul>
          {explainer.does.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="fm-tm__explainer-head">
          <X size={12} strokeWidth={2.6} aria-hidden className="fm-restore-explainer__no" />
          It does not
        </p>
        <ul>
          {explainer.doesNot.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="fm-tm__advanced">
          Advanced: each restore point is a hidden Git ref; each kept version is a Git commit.
        </p>
      </div>
      <RestoreSheet
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        entry={restoring}
        intent="restore"
        environmentId={environmentId}
        threadId={threadId}
        versionNumber={restoring?.number ?? null}
      />
    </>
  );
}
