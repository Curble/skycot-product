// The composer's "Plan first" switch for a grown-up. A Family profile shows a locked pill
// instead (FamilyAutonomyLock `planFirst`), because the engine enforces it there.
import { useId } from "react";

import { Switch } from "../../ui/Switch";
import { writePlanFirstChoice } from "../settings/localPrefs";
import { planFirstCopy, usePlanFirst } from "./planFirst";

export function PlanFirstSwitch() {
  const planFirst = usePlanFirst();
  const labelId = useId();
  if (planFirst.locked) return null;
  return (
    <span className="fm-planfirst">
      <Switch
        checked={planFirst.on}
        onChange={writePlanFirstChoice}
        label={planFirstCopy.label}
        labelledBy={labelId}
      />
      <span id={labelId} className="fm-planfirst__label">
        {planFirstCopy.label}
      </span>
    </span>
  );
}
