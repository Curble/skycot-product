// The server is the source of truth for the default runtime mode (SEC-03). `localStorage`
// only remembers the composer's last choice; Settings and anything that inherits the engine
// default must read and write the server setting through these helpers.
//
// Exported for the composer / onboarding (agent F3) and Settings:
//   - readServerDefaultRuntimeMode(settings)      pure: the engine default from a settings value
//   - useServerDefaultRuntimeMode(environmentId)  hook: the live engine default (null while loading)
//   - useSkycotPolicyEnabled(environmentId)       hook: true only when the server says its policy is on
//   - useWriteServerDefaultRuntimeMode(env)       hook: returns `(mode) => Promise<boolean>`
//   - useEnsureSafeServerDefault(environmentId)   hook: one-time repair of a stale `full-access` default
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, RuntimeMode, ServerSettings } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { serverEnvironment } from "./server";

export const SAFE_DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";

/** The same key `state/preferences.ts` writes; read here only to know whether it was ever set. */
const LOCAL_AUTONOMY_KEY = "skycot:autonomy";

export function readServerDefaultRuntimeMode(
  settings: Pick<ServerSettings, "defaultRuntimeMode"> | null | undefined,
): RuntimeMode | null {
  return settings?.defaultRuntimeMode ?? null;
}

export function useServerDefaultRuntimeMode(environmentId: EnvironmentId): RuntimeMode | null {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return readServerDefaultRuntimeMode(settings);
}

/** True only when the engine reports `skycotPolicy: true`; the client never assumes it. */
export function useSkycotPolicyEnabled(environmentId: EnvironmentId): boolean {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return config?.skycotPolicy === true;
}

export function useWriteServerDefaultRuntimeMode(
  environmentId: EnvironmentId,
): (mode: RuntimeMode) => Promise<boolean> {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  return async (mode) => {
    const result = await updateSettings({
      environmentId,
      input: { patch: { defaultRuntimeMode: mode } },
    });
    return result._tag === "Success";
  };
}

function hasLocalAutonomyChoice(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_AUTONOMY_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The engine ships with `full-access` as its default (upstream `DEFAULT_RUNTIME_MODE`). A user
 * who never touched the autonomy control would otherwise run Automations, Advanced-mode and
 * MCP-started threads unattended. Once per environment, if the server default is still
 * `full-access` and this browser has never recorded a choice, patch it to "Ask me first".
 * The brand env also sets `T3CODE_DEFAULT_RUNTIME_MODE=approval-required`, so this only fires
 * for settings files written before that.
 */
export function useEnsureSafeServerDefault(environmentId: EnvironmentId): void {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const write = useWriteServerDefaultRuntimeMode(environmentId);
  const repaired = useRef<Set<EnvironmentId>>(new Set());
  useEffect(() => {
    if (settings === null || repaired.current.has(environmentId)) return;
    if (settings.defaultRuntimeMode !== "full-access" || hasLocalAutonomyChoice()) return;
    repaired.current.add(environmentId);
    void write(SAFE_DEFAULT_RUNTIME_MODE);
  }, [environmentId, settings, write]);
}
