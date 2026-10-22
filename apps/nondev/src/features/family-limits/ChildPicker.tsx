// "Who's using SKYCOT?": the big, friendly picker a Family profile with more than one child
// shows when SKYCOT opens (once per window), and from Settings › Family › Switch. Choosing
// needs no code; moving away from a child SKYCOT is asleep for does (the engine says so), and
// then the code is asked for right here, without a second sheet on top.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../ui/Button";
import { Mascot } from "../brand/Mascot";
import { useModal } from "../../ui/useModal";
import { ChildAvatar } from "../family/ChildAvatar";
import { childLabel } from "../family/children";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { tryParentCode, useFamilyView } from "../family/store";
import { chooseChild } from "./store";

export function ChildPicker({
  onDone,
  dismissible,
}: {
  readonly onDone: () => void;
  /** Settings' Switch can be cancelled; the picker on open cannot (someone has to be chosen). */
  readonly dismissible: boolean;
}) {
  const view = useFamilyView();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [needsGrownUp, setNeedsGrownUp] = useState<{ childId: string; sentence: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  useModal(ref, {
    open: true,
    onClose: dismissible ? onDone : () => undefined,
    initialFocus: "first",
  });

  const choose = async (childId: string) => {
    setBusy(childId);
    setProblem(null);
    const result = await chooseChild(childId);
    setBusy(null);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.reason === "asleep") setNeedsGrownUp({ childId, sentence: result.message });
    else setProblem(result.message);
  };

  const entry = useParentCodeEntry(
    (code) => tryParentCode(code, "settings"),
    () => {
      if (needsGrownUp) void choose(needsGrownUp.childId);
      setNeedsGrownUp(null);
    },
  );

  return createPortal(
    <div
      ref={ref}
      className="fm-family-cover fm-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-picker-title"
      tabIndex={-1}
    >
      <div className="fm-picker__inner">
        <Mascot pose="hello" size={104} decorative />
        <h1 id="fm-picker-title" className="fm-picker__title">
          <span className="fm-marker-underline">Who's using SKYCOT?</span>
        </h1>
        {needsGrownUp ? (
          <div className="fm-picker__grownup" data-sober="">
            <p className="fm-picker__lead">{needsGrownUp.sentence}</p>
            <ParentCodeEntry entry={entry} autoFocus />
            <div className="fm-picker__actions">
              <Button onClick={() => setNeedsGrownUp(null)} disabled={entry.busy}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!entry.canSubmit}
                onClick={() => void entry.submit()}
              >
                {entry.busy ? "Checking…" : "Switch"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="fm-picker__lead">Tap your picture.</p>
            <ul className="fm-picker__grid">
              {view.children.map((child, index) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className={`fm-picker__tile${child.id === view.currentChildId ? " fm-picker__tile--last" : ""}`}
                    disabled={busy !== null}
                    aria-current={child.id === view.currentChildId ? "true" : undefined}
                    onClick={() => void choose(child.id)}
                  >
                    <ChildAvatar child={child} size={112} />
                    <span className="fm-picker__name">{childLabel(child, index)}</span>
                    {busy === child.id ? <span className="fm-picker__hint">Opening…</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {problem ? (
              <p className="fm-picker__problem" role="alert">
                {problem}
              </p>
            ) : null}
            {dismissible ? (
              <div className="fm-picker__actions">
                <Button onClick={onDone}>Cancel</Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
