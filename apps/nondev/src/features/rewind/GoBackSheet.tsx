import { Check, FileStack, MessageSquareText, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { useCrew } from "../../themes/useCrew";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { countReplaced, type FilesChoice, type RewindTarget } from "./rewind";

export type GoBackStage = "idle" | "going-back" | "sending";

/**
 * "Go back to here?": the one confirmation before a changed message replaces what came after
 * it. Keeping the files is chosen to start with (it changes nothing on disk); putting them back
 * is the same restore as Undo and says what that can't undo.
 */
export function GoBackSheet({
  open,
  target,
  choice,
  planFirst,
  stage,
  problem,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly target: RewindTarget | null;
  readonly choice: FilesChoice;
  readonly planFirst: boolean;
  readonly stage: GoBackStage;
  readonly problem: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (restoreFiles: boolean) => void;
}) {
  const crew = useCrew();
  const builder = crew.builder.name;
  const [putBack, setPutBack] = useState(false);
  if (target === null) return null;
  const busy = stage !== "idle";
  const files = target.filesChanged;
  const fileWord = `${files} ${files === 1 ? "file" : "files"}`;
  const restoreFiles = choice.kind === "choose" && putBack;

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title="Go back to here?"
      icon={RotateCcw}
      iconTone="blue"
      sober
      dismissOnBackdrop={false}
      description={`${builder} goes back to just before this message and starts again from your changed one. ${countReplaced(target, builder)}`}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={restoreFiles ? "destructive" : "primary"}
            filled
            disabled={busy}
            onClick={() => onConfirm(restoreFiles)}
          >
            {stage === "going-back"
              ? "Going back…"
              : stage === "sending"
                ? "Sending…"
                : restoreFiles
                  ? "Go back and put files back"
                  : "Go back and send"}
          </Button>
        </>
      }
      note="Your project's own folder is never touched."
    >
      {problem ? <Banner tone="warning">{problem}</Banner> : null}

      {choice.kind === "nothing" ? (
        <p className="fm-goback__lead">
          No files changed after this message, so there's nothing to put back.
        </p>
      ) : (
        <div className="fm-goback__choices" role="radiogroup" aria-label="What about the files?">
          <p className="fm-goback__lead">What about the files?</p>
          <Choice
            icon={MessageSquareText}
            title="Keep the files as they are"
            text={`Everything ${builder} made stays. Only the conversation goes back.`}
            checked={!restoreFiles}
            disabled={busy}
            onClick={() => setPutBack(false)}
          />
          <Choice
            icon={FileStack}
            title="Put the files back too"
            text={
              choice.kind === "choose"
                ? `Like Undo: the ${fileWord} ${builder} changed from this message on go back to how they were. Versions shows the later versions as undone; they can't be brought back.`
                : choice.because
            }
            checked={restoreFiles}
            disabled={busy || choice.kind !== "choose"}
            onClick={() => setPutBack(true)}
          />
        </div>
      )}

      <div className="fm-restore-explainer">
        <ul className="fm-restore-explainer__list" aria-label="Going back does">
          {[
            planFirst
              ? `Sends your changed message as a new request. ${builder} shows a plan first.`
              : "Sends your changed message as a new request.",
            "Files only ever go back to a version SKYCOT saved. Nothing else is deleted.",
            // The engine drops taken-back turns from the conversation it sends on the next
            // load, so they are only folded in this window until then.
            `Folds away the replaced replies. ${builder} won't remember them.`,
          ].map((line) => (
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
        <ul className="fm-restore-explainer__list" aria-label="Going back does not">
          {["Doesn't change anything already sent for review or put live."].map((line) => (
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

function Choice({
  icon: Icon,
  title,
  text,
  checked,
  disabled,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly text: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      className={`fm-goback__choice${checked ? " fm-goback__choice--on" : ""}`}
      onClick={onClick}
    >
      <span className="fm-goback__radio" aria-hidden />
      <span className="fm-goback__icon" aria-hidden>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="fm-goback__words">
        <span className="fm-goback__title">{title}</span>
        <span className="fm-goback__text">{text}</span>
      </span>
    </button>
  );
}
