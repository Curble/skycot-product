// The small locked "Ask me first" the composer and Settings show instead of
// the autonomy control while the Family profile is on.
import { Lock } from "lucide-react";

import { AUTONOMY_LEVELS } from "../../plain/autonomy";
import { familyCopy } from "./copy";

export function FamilyAutonomyLock({ note = familyCopy.alwaysAsks }: { readonly note?: string }) {
  return (
    <span className="fm-family-lock" role="status">
      <span className="fm-family-lock__pill">
        <Lock size={11} strokeWidth={2.2} aria-hidden />
        {AUTONOMY_LEVELS.askMeFirst.label}
      </span>
      <span className="fm-family-lock__note">{note}</span>
    </span>
  );
}
