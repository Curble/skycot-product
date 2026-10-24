import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Check, GitCommitHorizontal, X } from "lucide-react";
import { useState } from "react";

import { restoreExplainerFor } from "../../plain/versions";
import { Button } from "../../ui/Button";
import { Pill, type PillTone } from "../../ui/Pill";
import { RestoreSheet } from "./RestoreSheet";
import { formatVersionTime, useVersionsTimeline, type NumberedVersion } from "./timeline";
import { useChildView } from "../../app/useChildView";

const KIND_TONE: Record<NumberedVersion["kind"], PillTone> = {
  "restore point": "neutral",
  "kept version": "ok",
  live: "working",
};

/**
 * The Time Machine column: every point you can step back to, newest first,
 * with a Restore button per point and the fixed does / does-not explainer.
 * Shared by the right-hand rail and the narrow-screen sheet. A blocked
 * Restore stays tappable: the reason appears under the row, so it never
 * lives only in a hover tooltip.
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
  const [explained, setExplained] = useState<string | null>(null);
  const active = shell ? threadRuntimeIsActive(shell.runtime) : false;
  const explainer = restoreExplainerFor();
  const childView = useChildView();

  return (
    <>
      {timeline.entries.length === 0 ? (
        <p className="fm-tm__empty">
          {childView
            ? "No earlier tries yet."
            : "No versions yet. The first one appears when a change finishes."}
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
            const whyId = `fm-tm-why-${entry.id}`;
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
                  {entry.number ? <RailLabel label={entry.label} /> : null}
                  <span className="fm-tm__meta">
                    {formatVersionTime(entry.timestamp)}
                    {entry.isCurrent ? " · now" : ""}
                    {entry.undone ? " · undone" : ""}
                    <Pill tone={KIND_TONE[entry.kind]} size="sm" dot={false}>
                      {entry.kindLabel}
                    </Pill>
                    {entry.kept ? (
                      <span className="fm-tm__kept">
                        <GitCommitHorizontal size={12} strokeWidth={2.2} aria-hidden />
                        Kept · commit {entry.kept.sha.slice(0, 7)}
                      </span>
                    ) : null}
                  </span>
                </div>
                {entry.kind === "restore point" ? (
                  <Button
                    size="sm"
                    aria-disabled={!canRestore}
                    aria-describedby={!canRestore && explained === entry.id ? whyId : undefined}
                    aria-label={`Restore to ${entry.label}`}
                    onClick={() => {
                      if (canRestore) setRestoring(entry);
                      else setExplained((current) => (current === entry.id ? null : entry.id));
                    }}
                  >
                    {childView ? "Go back" : "Restore"}
                  </Button>
                ) : null}
                {!canRestore && blocker && explained === entry.id ? (
                  <p id={whyId} className="fm-tm__why" role="status">
                    {blocker}
                  </p>
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
      {!childView ? (
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
            Advanced: each restore point is a hidden Git ref; a kept version is a Git commit on the
            conversation's branch.
          </p>
        </div>
      ) : null}
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

/**
 * The change note under "Version N". The line counts sit on their own line so
 * a two-line clamp never cuts them mid-number (QA-P2-3-08); the full sentence
 * stays in the Restore sheet.
 */
function RailLabel({ label }: { readonly label: string }) {
  const match = /^(.*?)\s*(\(\+\d+ \/ −\d+ lines?\))$/.exec(label);
  if (match === null) {
    return <span className="fm-tm__label">{label}</span>;
  }
  return (
    <>
      <span className="fm-tm__label">{match[1]}</span>
      <span className="fm-tm__counts">{match[2]}</span>
    </>
  );
}
