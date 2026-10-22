// The small locked "Ask me first" the composer and Settings show instead of
// the autonomy control while the Family profile is on (and, in the composer,
// the locked "Plan first" beside it).
import { Lock } from "lucide-react";

import { AUTONOMY_LEVELS } from "../../plain/autonomy";
import { familyCopy } from "./copy";

export function FamilyAutonomyLock({
  note = familyCopy.alwaysAsks,
  planFirst = false,
}: {
  readonly note?: string;
  readonly planFirst?: boolean;
}) {
  return (
    <span className="fm-family-lock" role="status">
      <span className="fm-family-lock__pill">
        <Lock size={11} strokeWidth={2.2} aria-hidden />
        {AUTONOMY_LEVELS.askMeFirst.label}
      </span>
      {planFirst ? (
        <span className="fm-family-lock__pill">
          <Lock size={11} strokeWidth={2.2} aria-hidden />
          Plan first
        </span>
      ) : null}
      <span className="fm-family-lock__note">{note}</span>
    </span>
  );
}
