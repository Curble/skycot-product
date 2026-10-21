// One code prompt, shared by every place that asks for the parent code: the
// standalone sheet, the Publish step, the automation sheet and the Advanced-
// mode sheet. The host owns its buttons and calls `submit`; this file owns
// the field, the attempt counter and the lockout sentence. Always rendered
// inside a `data-sober` region: no marker pens on a code prompt.
import { useEffect, useState } from "react";

import { Banner } from "../../ui/Banner";
import { TextField } from "../../ui/TextField";
import {
  CODE_MAX,
  digitsOnly,
  isValidCode,
  lockoutRemainingMs,
  lockoutSentence,
  wrongCodeSentence,
} from "./family";
import { tryParentCode, useFamilyProfile } from "./store";

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

export function useParentCodeEntry(onVerified: () => void): ParentCodeEntryState {
  const profile = useFamilyProfile();
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // The clock is state, re-read every 15 s while locked so the sentence counts
  // down; a tick, not an animation.
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = lockoutRemainingMs(profile, now);
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
    const outcome = await tryParentCode(code);
    setBusy(false);
    setNow(Date.now());
    setCodeRaw("");
    if (outcome.ok) {
      setFeedback(null);
      onVerified();
      return true;
    }
    setFeedback(
      outcome.kind === "locked"
        ? lockoutSentence(outcome.remainingMs)
        : wrongCodeSentence(outcome.attemptsLeft),
    );
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
