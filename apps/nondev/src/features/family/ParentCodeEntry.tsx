// One code prompt, shared by every place that asks for the parent code: the standalone
// sheet, the Publish step, the automation sheet, the Advanced-mode sheet and the "Ask a
// grown-up" card. The host owns its buttons and calls `submit`; this file owns the field and
// the sentence. The engine checks the code and counts the tries; this only shows its answer.
// Always rendered inside a `data-sober` region: no marker pens on a code prompt.
//
// When the engine has told this device how long the code is (the Mac, a grown-up's device),
// the last digit tries it at once, like the iPhone's lock screen; the host's button stays for
// when the length is unknown. The engine still counts every try the same way.
import { useEffect, useRef, useState } from "react";

import { Banner } from "../../ui/Banner";
import { TextField } from "../../ui/TextField";
import type { FamilyResult } from "./api";
import {
  CODE_MAX,
  codeComplete,
  digitsOnly,
  isValidCode,
  lockoutSentence,
  viewLockRemainingMs,
} from "./family";
import { useFamilyView } from "./store";

export interface ParentCodeEntryState {
  readonly code: string;
  readonly setCode: (value: string) => void;
  /** Tries the code once; resolves true when it matched. Also runs on Enter in the field. */
  readonly submit: () => Promise<boolean>;
  readonly busy: boolean;
  readonly locked: boolean;
  readonly canSubmit: boolean;
  readonly feedback: string | null;
  /** How many digits the code has, when the engine said; null when the button is the way. */
  readonly codeLength: number | null;
}

/** What one try does with the code: ask the engine for a grant, turn the profile off, … */
export type ParentCodeAttempt = (code: string) => Promise<FamilyResult<unknown>>;

export function useParentCodeEntry(
  attempt: ParentCodeAttempt,
  onVerified: () => void,
): ParentCodeEntryState {
  const view = useFamilyView();
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // The clock is state, re-read every 15 s while locked so the sentence counts down; a tick,
  // not an animation.
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = viewLockRemainingMs(view, now);
  const locked = remainingMs > 0;
  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [locked]);

  // One try at a time, even when the last digit and Enter (or the button) land together: the
  // state's `busy` only changes on the next render, this changes at once.
  const trying = useRef(false);
  const codeLength = view.codeLength;

  const tryCode = async (value: string) => {
    if (trying.current || busy || locked || !isValidCode(value)) return false;
    trying.current = true;
    setBusy(true);
    try {
      const result = await attempt(value);
      setNow(Date.now());
      setCodeRaw("");
      if (result.ok) {
        setFeedback(null);
        onVerified();
        return true;
      }
      setFeedback(result.message);
      return false;
    } finally {
      trying.current = false;
      setBusy(false);
    }
  };

  const setCode = (value: string) => {
    const digits = digitsOnly(value);
    setCodeRaw(digits);
    setFeedback(null);
    // The last digit is the Enter key: no button press needed once the length is known.
    if (codeComplete(digits, codeLength)) void tryCode(digits);
  };

  const submit = () => tryCode(code);

  return {
    code,
    setCode,
    submit,
    busy,
    locked,
    canSubmit: !busy && !locked && isValidCode(code),
    feedback: locked && feedback === null ? lockoutSentence(remainingMs) : feedback,
    codeLength,
  };
}

export function ParentCodeEntry({
  entry,
  label = "Parent code",
  autoFocus = false,
}: {
  readonly entry: ParentCodeEntryState;
  readonly label?: string;
  readonly autoFocus?: boolean;
}) {
  // A wrong try empties the field: put the cursor back so the next try is just typing.
  const field = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !entry.busy && entry.feedback !== null && !entry.locked) {
      field.current?.focus();
    }
    wasBusy.current = entry.busy;
  }, [entry.busy, entry.feedback, entry.locked]);
  return (
    <div className="fm-family-code" data-sober="">
      <TextField
        label={label}
        inputRef={field}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={entry.codeLength ?? CODE_MAX}
        placeholder={"•".repeat(entry.codeLength ?? 4)}
        value={entry.code}
        disabled={entry.busy || entry.locked}
        autoFocus={autoFocus}
        onChange={(event) => entry.setCode(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && entry.canSubmit) {
            event.preventDefault();
            void entry.submit();
          }
        }}
      />
      {entry.feedback ? (
        <Banner tone={entry.locked ? "danger" : "warning"}>{entry.feedback}</Banner>
      ) : (
        <p className="fm-help">
          {entry.codeLength === null ? "4 to 6 digits" : `${entry.codeLength} digits`}. Five wrong
          tries mean a five-minute wait.
        </p>
      )}
    </div>
  );
}
