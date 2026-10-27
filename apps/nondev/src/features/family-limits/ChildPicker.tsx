// "Who's using SKYCOT?": the big, friendly picker a Family profile with more than one child
// shows when SKYCOT opens (once per window), and from Settings › Family › Switch. Choosing
// needs no code; moving away from a child SKYCOT is asleep for does (the engine says so), and
// then the code is asked for right here, without a second sheet on top.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../ui/Button";
import { Mascot } from "../brand/Mascot";
import { useModal } from "../../ui/useModal";
import { ChildAvatar } from "../family/ChildAvatar";
import { childLabel } from "../family/children";
import { endGrownUpSession, startGrownUpSession } from "../family/grownUpSession";
import { grownUpLabel } from "../family/people";
import { ParentCodeEntry, useParentCodeEntry } from "../family/ParentCodeEntry";
import { tryParentCode, useFamilyView } from "../family/store";
import { chooseChild } from "./store";
import { bufferPickerCode, rememberChild } from "./idlePicker";

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
  const earlyCode = useRef("");
  const captureCode = useRef(false);
  const captureKey = useRef<((event: KeyboardEvent) => void) | null>(null);
  const captureTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [needsGrownUp, setNeedsGrownUp] = useState<{ childId: string; sentence: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  /** A grown-up's tile was tapped: their code first, then the grown-up view. */
  const [grownUp, setGrownUp] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  );
  useEffect(() => {
    if (grownUp === null && needsGrownUp === null) return;
    const field = ref.current?.querySelector<HTMLInputElement>("input[type=password]");
    if (!field) return;
    captureCode.current = false;
    if (captureKey.current) window.removeEventListener("keydown", captureKey.current, true);
    captureKey.current = null;
    field.focus();
    if (earlyCode.current) {
      const value = earlyCode.current;
      earlyCode.current = "";
      entry.setCode(value);
    }
  }, [grownUp, needsGrownUp]);
  useEffect(
    () => () => {
      if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
      if (captureKey.current) window.removeEventListener("keydown", captureKey.current, true);
    },
    [],
  );

  const startCodeCapture = () => {
    earlyCode.current = "";
    captureCode.current = true;
    const capture = (event: KeyboardEvent) => {
      if (!captureCode.current) {
        window.removeEventListener("keydown", capture, true);
        return;
      }
      const next = bufferPickerCode(earlyCode.current, event.key);
      if (next !== null) {
        earlyCode.current = next;
        event.preventDefault();
      } else if (event.key === "Enter") {
        event.preventDefault();
      }
    };
    captureKey.current = capture;
    window.addEventListener("keydown", capture, true);
    if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
    captureTimer.current = window.setTimeout(() => {
      if (captureCode.current) {
        captureCode.current = false;
        window.removeEventListener("keydown", capture, true);
        captureKey.current = null;
      }
      captureTimer.current = null;
    }, 1000);
  };
  useModal(ref, {
    open: true,
    onClose: dismissible ? onDone : () => undefined,
    initialFocus: "first",
  });

  const choose = async (childId: string) => {
    setBusy(childId);
    setProblem(null);
    endGrownUpSession();
    const result = await chooseChild(childId);
    setBusy(null);
    if (result.ok) {
      rememberChild(childId, Date.now());
      onDone();
      return;
    }
    if (result.reason === "asleep") setNeedsGrownUp({ childId, sentence: result.message });
    else setProblem(result.message);
  };

  const entry = useParentCodeEntry(
    (code) => tryParentCode(code, "settings"),
    () => {
      if (grownUp) {
        startGrownUpSession(grownUp.id);
        setGrownUp(null);
        onDone();
        return;
      }
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
        <div className="fm-picker__hello">
          <Mascot pose="hello" size={104} decorative />
          <span className="fm-picker__bubble">Hi! Who's making today?</span>
        </div>
        <h1 id="fm-picker-title" className="fm-picker__title">
          <span className="fm-marker-underline">Who's using SKYCOT?</span>
        </h1>
        {needsGrownUp || grownUp ? (
          <div className="fm-picker__grownup" data-sober="">
            <p className="fm-picker__lead">
              {grownUp
                ? `Hi ${grownUp.name}! Enter the parent code to check it's you.`
                : needsGrownUp?.sentence}
            </p>
            <ParentCodeEntry entry={entry} autoFocus />
            <div className="fm-picker__actions">
              <Button
                onClick={() => {
                  setNeedsGrownUp(null);
                  setGrownUp(null);
                }}
                disabled={entry.busy}
              >
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!entry.canSubmit}
                onClick={() => void entry.submit()}
              >
                {entry.busy ? "Checking…" : grownUp ? "Open" : "Switch"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="fm-picker__lead fm-sr-only">Tap your name tag.</p>
            <div className="fm-picker__groups">
              <section className="fm-picker__group fm-picker__group--makers" aria-label="Kids">
                <h2 className="fm-picker__group-title">Kids</h2>
                <ul className="fm-picker__tags">
                  {view.children.map((child, index) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className={`fm-picker__tag${child.id === view.currentChildId ? " fm-picker__tag--last" : ""}`}
                        disabled={busy !== null}
                        aria-current={child.id === view.currentChildId ? "true" : undefined}
                        onClick={() => void choose(child.id)}
                      >
                        <span className="fm-picker__tag-hello" aria-hidden>
                          HELLO <small>my name is</small>
                        </span>
                        <ChildAvatar child={child} size={104} />
                        <span className="fm-picker__name">{childLabel(child, index)}</span>
                        {busy === child.id ? (
                          <span className="fm-picker__hint">Opening…</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {view.grownUps.length > 0 ? (
                <section
                  className="fm-picker__group fm-picker__group--grown-ups"
                  aria-label="Grown-ups"
                >
                  <h2 className="fm-picker__group-title">Grown-ups</h2>
                  <ul className="fm-picker__tags fm-picker__tags--small">
                    {view.grownUps.map((person, index) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          className="fm-picker__tag fm-picker__tag--grown-up"
                          disabled={busy !== null}
                          onClick={() => {
                            startCodeCapture();
                            setGrownUp({ id: person.id, name: grownUpLabel(person, index) });
                          }}
                        >
                          <span className="fm-picker__tag-hello" aria-hidden>
                            HELLO <small>my name is</small>
                          </span>
                          <ChildAvatar child={person} size={64} />
                          <span className="fm-picker__name">{grownUpLabel(person, index)}</span>
                          <span
                            className="fm-picker__stamp"
                            aria-label="Grown-up, needs the parent code"
                          >
                            🔒 Grown-up
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
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
