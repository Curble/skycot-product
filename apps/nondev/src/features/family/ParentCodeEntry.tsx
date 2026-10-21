// One code prompt, shared by every place that asks for the parent code: the standalone
// sheet, the Publish step, the automation sheet, the Advanced-mode sheet and the "Ask a
// grown-up" card. The host owns its buttons and calls `submit`; this file owns the field and
// the sentence. The engine checks the code and counts the tries; this only shows its answer.
// Always rendered inside a `data-sober` region: no marker pens on a code prompt.
import { useEffect, useState } from "react";

import { Banner } from "../../ui/Banner";
import { TextField } from "../../ui/TextField";
import type { FamilyResult } from "./api";
import { CODE_MAX, digitsOnly, isValidCode, lockoutSentence, viewLockRemainingMs } from "./family";
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

  const setCode = (value: string) => {
    setCodeRaw(digitsOnly(value));
    setFeedback(null);
  };

  const submit = async () => {
    if (busy || locked || !isValidCode(code)) return false;
    setBusy(true);
    const result = await attempt(code);
    setBusy(false);
    setNow(Date.now());
    setCodeRaw("");
    if (result.ok) {
      setFeedback(null);
      onVerified();
      return true;
    }
    setFeedback(result.message);
    return false;
  };

  return {
    code,
    setCode,
    submit,
    busy,
    locked,
    canSubmit: !busy && !locked && isValidCode(code),
    feedback: locked && feedback === null ? lockoutSentence(remainingMs) : feedback,
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
  return (
    <div className="fm-family-code" data-sober="">
      <TextField
        label={label}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={CODE_MAX}
        placeholder="••••"
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
        <p className="fm-help">4 to 6 digits. Five wrong tries mean a five-minute wait.</p>
      )}
    </div>
  );
}
