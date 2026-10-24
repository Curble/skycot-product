import { useFamily } from "../features/family/FamilyProvider";
import { readLimits } from "../features/family-limits/store";
import { childPickerRequested } from "../features/family-limits/FamilyLimitsHost";
import { readFamilyView } from "../features/family/store";
import { childSessionFor } from "../features/updates/readyNotice";

/** True only when family protections are on and this device belongs to a child. */
export function useChildView(): boolean {
  const family = useFamily();
  return family.enabled && family.profile.me.kind !== "grown-up";
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
