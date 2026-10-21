// Turning the Family profile on also sets the defaults it promises: the
// Workshop look, "Ask me first" locally and on the engine (the server default
// is the source of truth, SEC-03), and larger text. Each is an ordinary
// preference the parent can change afterwards; only autonomy is then locked.
import type { EnvironmentId } from "@t3tools/contracts";

import { writeAutonomy } from "../../state/preferences";
import { SAFE_DEFAULT_RUNTIME_MODE, useWriteServerDefaultRuntimeMode } from "../../state/autonomy";
import { readActiveThemeId, setActiveTheme } from "../../themes/store";
import { writeTextSize } from "../settings/localPrefs";
import { enableFamily } from "./store";

export const FAMILY_THEME_ID = "workshop";

export function useEnableFamilyWithDefaults(
  environmentId: EnvironmentId,
): (input: { readonly childName: string | null; readonly code: string }) => Promise<void> {
  const writeServerMode = useWriteServerDefaultRuntimeMode(environmentId);
  return async (input) => {
    await enableFamily(input);
    writeAutonomy("ask-first");
    writeTextSize("large");
    // A look the parent already picked during onboarding stands; Workshop only replaces Classic.
    if (readActiveThemeId() === "classic") setActiveTheme(FAMILY_THEME_ID);
    void writeServerMode(SAFE_DEFAULT_RUNTIME_MODE);
  };
}
