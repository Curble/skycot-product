import type { DesktopCliCommandState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { APP_BASE_NAME, CLI_COMMAND_NAME } from "~/branding"; // nondev-seam: brand-advanced-cli-command-settings-row

export function CliCommandSettingsRow() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.cliCommand;
  const [state, setState] = useState<DesktopCliCommandState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .getState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const change = (action: "install" | "uninstall") => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(setState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              action === "install"
                ? `Could not install ${CLI_COMMAND_NAME}`
                : `Could not remove ${CLI_COMMAND_NAME}`,
            description: error instanceof Error ? error.message : "Something went wrong.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  if (!bridge || !state?.supported) return null;
  const installed = state.installedPath !== null;
  // nondev-seam: brand-advanced-cli-command-settings-row (an older build's own `t3`, replaced on Install)
  const replaces = !installed && state.replaces ? state.replaces : null;
  const description = state.shadowedBy
    ? `Another ${CLI_COMMAND_NAME} at ${state.shadowedBy} runs first in a new terminal. Remove it to use ${APP_BASE_NAME}'s.`
    : replaces
      ? `An older version of ${APP_BASE_NAME} installed its command as \`t3\` at ${replaces}. Replace it with \`${CLI_COMMAND_NAME}\` so it never clashes with another app's \`t3\`.`
      : !installed
        ? `Run ${APP_BASE_NAME}'s CLI as \`${CLI_COMMAND_NAME}\` from any terminal.`
        : state.onPath
          ? `Installed at ${state.installedPath}. Open a new terminal to use it.`
          : `Installed at ${state.installedPath}, which is not on your PATH yet. Add its folder to your PATH to run \`${CLI_COMMAND_NAME}\`.`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => change(installed ? "uninstall" : "install")}
        >
          {installed ? "Remove" : replaces ? "Replace" : "Install"}
        </Button>
      }
    />
  );
}
