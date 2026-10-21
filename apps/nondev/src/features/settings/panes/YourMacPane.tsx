import { useAtomValue } from "@effect/atom-react";
import type { DesktopServerExposureState, EnvironmentId } from "@t3tools/contracts";
import { Laptop, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { ADVANCED_MODE_LABEL } from "../../../brand";
import { advancedModeUrl, isElectron } from "../../../app/platform";
import { environmentCatalog } from "../../../state/catalog";
import { serverEnvironment } from "../../../state/server";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { SettingsGroup } from "../SettingsGroup";

const OS_NAMES = {
  darwin: "macOS",
  linux: "Linux",
  windows: "Windows",
  unknown: "Unknown",
} as const;

export function YourMacPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const label =
    catalog.entries.get(environmentId)?.target.label ?? config?.environment.label ?? "This Mac";
  const [exposure, setExposure] = useState<DesktopServerExposureState | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getServerExposureState) return;
    let cancelled = false;
    void bridge.getServerExposureState().then(
      (state) => {
        if (!cancelled) setExposure(state);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const os = config?.environment.platform.os;
  const machine = config?.environment.platform.machine;
  const remoteOn = exposure?.mode === "network-accessible";

  return (
    <>
      <SettingsGroup
        title="This computer"
        footer="SKYCOT runs on this computer and keeps every project here. Nothing is stored anywhere else unless you send it for review or put it live."
      >
        <ListRow
          leading={<StepBadge state="ok" icon={Laptop} />}
          title={label}
          subtitle={
            config
              ? `${os ? OS_NAMES[os] : "Unknown system"}${machine ? ` · ${machine}` : ""} · engine ${config.environment.serverVersion}`
              : "Connecting…"
          }
        />
        {config ? (
          <ListRow
            title="Working folder"
            subtitle={<code className="fm-code">{config.cwd}</code>}
          />
        ) : null}
        {config?.newProjectsRoot ? (
          <ListRow
            title="New projects go in"
            subtitle={<code className="fm-code">{config.newProjectsRoot}</code>}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Remote access"
        footer={
          isElectron
            ? `Switching this on or off, and linking a phone, lives in ${ADVANCED_MODE_LABEL} under Connections.`
            : `Whether other devices can reach this Mac is managed in ${ADVANCED_MODE_LABEL} under Connections.`
        }
      >
        <ListRow
          leading={<StepBadge state={remoteOn ? "ok" : "todo"} icon={Wifi} />}
          title={
            exposure
              ? remoteOn
                ? "Reachable from your other devices"
                : "Only this computer"
              : "Managed in Advanced mode"
          }
          subtitle={
            exposure
              ? remoteOn
                ? exposure.advertisedHost
                  ? `Other devices on your network can connect via ${exposure.advertisedHost}.`
                  : "Other devices on your network can connect."
                : "Nothing outside this computer can reach SKYCOT."
              : "Open Advanced mode to see whether phones or other computers can connect."
          }
          trailing={
            exposure ? (
              <Pill tone={remoteOn ? "ok" : "neutral"} size="sm">
                {remoteOn ? "On" : "Off"}
              </Pill>
            ) : (
              <Button
                size="sm"
                onClick={() => window.location.assign(`${advancedModeUrl()}settings/connections`)}
              >
                Open
              </Button>
            )
          }
        />
      </SettingsGroup>
    </>
  );
}
