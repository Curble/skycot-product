// The small locked pill the composer and Settings show instead of the autonomy control while
// the Family profile is on (and, in the composer, the locked "Plan first" beside it). It says
// how the child's steps run: safe steps by themselves, or, when a parent chose it for this
// child, "Ask me first".
import { Lock } from "lucide-react";

import { familySteps } from "./copy";
import { useFamilySteps } from "./FamilyProvider";

export function FamilyAutonomyLock({
  note,
  planFirst = false,
}: {
  /** The sentence beside the pill; the child's own step wording when left out. */
  readonly note?: string;
  readonly planFirst?: boolean;
}) {
  const steps = useFamilySteps() ?? familySteps(false);
  return (
    <span className="fm-family-lock" role="status">
      <span className="fm-family-lock__pill">
        <Lock size={11} strokeWidth={2.2} aria-hidden />
        {steps.label}
      </span>
      {planFirst ? (
        <span className="fm-family-lock__pill">
          <Lock size={11} strokeWidth={2.2} aria-hidden />
          Plan first
        </span>
      ) : null}
      <span className="fm-family-lock__note">{note ?? steps.description}</span>
    </span>
  );
}
