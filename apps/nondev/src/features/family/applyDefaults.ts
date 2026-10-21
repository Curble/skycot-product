// Turning the Family profile on (on the engine) also sets the defaults it promises: the
// Workshop look, "Ask me first" locally and on the engine, and larger text. Look and text
// size stay ordinary preferences; autonomy is then held by the engine.
import type { EnvironmentId } from "@t3tools/contracts";

import { writeAutonomy } from "../../state/preferences";
import { SAFE_DEFAULT_RUNTIME_MODE, useWriteServerDefaultRuntimeMode } from "../../state/autonomy";
import { readActiveThemeId, setActiveTheme } from "../../themes/store";
import { writeTextSize } from "../settings/localPrefs";
import { enableFamily } from "./store";

export const FAMILY_THEME_ID = "workshop";

/** Resolves null once the engine keeps the profile, or the sentence saying why it could not. */
export function useEnableFamilyWithDefaults(
  environmentId: EnvironmentId,
): (input: { readonly childName: string | null; readonly code: string }) => Promise<string | null> {
  const writeServerMode = useWriteServerDefaultRuntimeMode(environmentId);
  return async (input) => {
    const result = await enableFamily(input);
    if (!result.ok) return result.message;
    writeAutonomy("ask-first");
    writeTextSize("large");
    // A look the parent already picked during onboarding stands; Workshop only replaces Classic.
    if (readActiveThemeId() === "classic") setActiveTheme(FAMILY_THEME_ID);
    // The engine pins this itself when the profile turns on; writing it here too keeps the
    // settings view in step without waiting for the next refresh.
    void writeServerMode(SAFE_DEFAULT_RUNTIME_MODE);
    return null;
  };
}
