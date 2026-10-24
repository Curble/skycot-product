// The person's default AI assistant (Settings › AI assistants › Use by default). It is the
// engine's own `defaultModelSelection` setting, the one Advanced mode's "Default model" writes,
// so both clients, the engine's own new conversations and the model fallback (which treats the
// model a message asks for as the person's choice) agree. Null is "Automatic": the first
// assistant that is ready, as before. With the Family profile on, only assistants a child may
// use count (Codex and Claude, or one a grown-up allowed), and changing it takes the parent
// code; the engine refuses the change without it (SkycotFamilyGate, settings grant).
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { useFamily } from "../features/family/FamilyProvider";
import { defaultAssistantPreference, type DefaultAssistantPreference } from "./providers";
import { serverEnvironment } from "./server";

const EMPTY_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null).pipe(
  Atom.withLabel("nondev-default-assistant-settings:empty"),
);

export function useDefaultAssistantPreference(
  environmentId: EnvironmentId | null,
): DefaultAssistantPreference {
  const settings = useAtomValue(
    environmentId === null
      ? EMPTY_SETTINGS_ATOM
      : serverEnvironment.settingsValueAtom(environmentId),
  );
  const family = useFamily();
  const chosen = settings?.defaultModelSelection ?? null;
  const allowed = family.profile.allowedAssistants;
  const enabled = family.enabled;
  return useMemo(
    () =>
      defaultAssistantPreference(
        { defaultModelSelection: chosen },
        { enabled, allowedAssistants: allowed },
      ),
    [chosen, enabled, allowed],
  );
}

/** Writes the choice (null for Automatic), after the parent code when the Family profile is on. */
export function useWriteDefaultAssistant(
  environmentId: EnvironmentId,
): (selection: ModelSelection | null) => Promise<boolean> {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const family = useFamily();
  return async (selection) => {
    if (!(await family.requireParentCode("aiSettings"))) return false;
    const result = await updateSettings({
      environmentId,
      input: { patch: { defaultModelSelection: selection } },
    });
    return result._tag === "Success";
  };
}
