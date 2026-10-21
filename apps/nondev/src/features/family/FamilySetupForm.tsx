// The Family set-up: child's first name (optional, kept by the engine on this Mac), the
// parent code typed twice with a strength nudge, and the honesty box. Used as
// an onboarding step and inside Settings › Family's "Set up" sheet; the host
// owns the Continue button and reads `setupReady(draft)`.
import { Check, Minus } from "lucide-react";

import { Banner } from "../../ui/Banner";
import { TextField } from "../../ui/TextField";
import { familyCopy } from "./copy";
import {
  CODE_MAX,
  codeStrength,
  digitsOnly,
  setupProblem,
  strengthHint,
  type FamilySetupDraft,
} from "./family";

export function FamilySetupForm({
  draft,
  onDraft,
  autoFocus = false,
}: {
  readonly draft: FamilySetupDraft;
  readonly onDraft: (next: FamilySetupDraft) => void;
  readonly autoFocus?: boolean;
}) {
  const strength = codeStrength(draft.code);
  const problem = setupProblem(draft);
  // Only nag once both fields have something in them; an empty confirm field is not a mistake yet.
  const showProblem = problem !== null && draft.confirm.length > 0;
  return (
    <div className="fm-family-setup">
      <TextField
        label="Child's first name (optional)"
        placeholder="Ava"
        autoComplete="off"
        autoFocus={autoFocus}
        value={draft.childName}
        onChange={(event) => onDraft({ ...draft, childName: event.currentTarget.value })}
      />
      <p className="fm-help">Only used for the greeting. It stays on this Mac.</p>
      <div className="fm-family-setup__codes" data-sober="">
        <div className="fm-family-setup__row">
          <TextField
            label="Parent code"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={CODE_MAX}
            placeholder="4 to 6 digits"
            value={draft.code}
            onChange={(event) => onDraft({ ...draft, code: digitsOnly(event.currentTarget.value) })}
          />
          <TextField
            label="Type it again"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={CODE_MAX}
            placeholder="Same code"
            value={draft.confirm}
            onChange={(event) =>
              onDraft({ ...draft, confirm: digitsOnly(event.currentTarget.value) })
            }
          />
        </div>
        <p
          className={`fm-help fm-family-strength${strength ? ` fm-family-strength--${strength}` : ""}`}
          role="status"
        >
          {strengthHint(strength, draft.code.length)}
        </p>
        {showProblem ? <Banner tone="warning">{problem}</Banner> : null}
      </div>
      {/* The form always sits under a sheet's h2, so its sub-headings are h3. */}
      <FamilyHonestyBox headingLevel={3} />
    </div>
  );
}

/** "What this does / does not do", word for word the same everywhere it appears. */
export function FamilyHonestyBox({
  compact = false,
  headingLevel = 4,
}: {
  readonly compact?: boolean;
  /** One below the heading the box sits under: 3 inside a sheet (h2), 4 under a Settings group (h3). */
  readonly headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className={`fm-family-honesty${compact ? " fm-family-honesty--compact" : ""}`}>
      <div className="fm-family-honesty__col">
        <Heading>What this does</Heading>
        <ul>
          {familyCopy.does.map((line) => (
            <li key={line}>
              <Check size={13} strokeWidth={2.4} aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="fm-family-honesty__col">
        <Heading>What it does not do</Heading>
        <ul>
          {familyCopy.doesNot.map((line) => (
            <li key={line}>
              <Minus size={13} strokeWidth={2.4} aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="fm-family-honesty__note">{familyCopy.honesty}</p>
    </div>
  );
}
