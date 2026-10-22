// The calm "5 minutes left" notice in the shell's notices row: no countdown animation, one
// line that changes once a minute (the heartbeat brings the new number).
import { Moon } from "lucide-react";

import { useFamily } from "../family/FamilyProvider";
import { headsUpSentence } from "./limits";
import { useLimits } from "./store";

export function FamilyHeadsUp() {
  const family = useFamily();
  const { session } = useLimits();
  const sentence = family.enabled && session?.limits ? headsUpSentence(session.limits) : null;
  if (sentence === null) return null;
  return (
    <div className="fm-headsup" role="status">
      <span className="fm-headsup__icon" aria-hidden>
        <Moon size={15} strokeWidth={2} />
      </span>
      <span className="fm-headsup__text">{sentence}</span>
    </div>
  );
}
