import { useFamily } from "../features/family/FamilyProvider";
import { grownUpSessionFor, useGrownUpSessionId } from "../features/family/grownUpSession";
import { readLimits } from "../features/family-limits/store";
import { childPickerRequested } from "../features/family-limits/FamilyLimitsHost";
import { readFamilyView } from "../features/family/store";
import { childSessionFor } from "../features/updates/readyNotice";

/** True only when family protections are on and this device belongs to a child. */
export function useChildView(): boolean {
  const family = useFamily();
  const grownUp = grownUpSessionFor(useGrownUpSessionId(), family.profile, Date.now());
  // A grown-up picked on the shared Mac (and proven with the code) sees the grown-up view.
  return family.enabled && family.profile.me.kind !== "grown-up" && grownUp === null;
}

/** Shared child-session check for non-React notices and UI that runs outside a hook. */
export function isChildSession(): boolean {
  const view = readFamilyView();
  const session = readLimits().session;
  return childSessionFor(view, {
    pickerOpen: childPickerRequested(),
    asleep: session?.limits?.asleep === true,
  });
}
