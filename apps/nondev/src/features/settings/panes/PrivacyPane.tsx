import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { EyeOff, FileText } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../../brand";
import { serverEnvironment } from "../../../state/server";
import { ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { SettingsGroup } from "../SettingsGroup";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Read-only on purpose: the engine has no usage-reporting setting to flip.
 * This client ships with every reporting endpoint empty and the desktop relay
 * flag off, so the honest statement is "nothing is sent", and the one thing
 * that can send diagnostics (an OTLP address in the engine's settings) is
 * shown when present.
 */
export function PrivacyPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const relayTelemetry = window.desktopBridge?.getRelayTelemetryEnabled?.() === true;
  const observability = config?.settings.observability;
  const exportTargets = [
    observability?.otlpTracesUrl,
    observability?.otlpMetricsUrl,
    observability?.otlpLogsUrl,
  ].filter((url): url is string => typeof url === "string" && url.length > 0);

  return (
    <>
      <SettingsGroup
        title="Usage reporting"
        footer={`${PRODUCT_NAME} is built so that nothing about how you use it is sent to anyone. There is no switch because there is nothing to switch on.`}
      >
        <ListRow
          leading={<StepBadge state="ok" icon={EyeOff} />}
          title="Off"
          subtitle={
            relayTelemetry
              ? "The desktop app's relay diagnostics are on; the simple interface still sends nothing."
              : "No analytics, no crash reports, no usage statistics leave this Mac."
          }
          trailing={
            <Pill tone="ok" size="sm">
              Off
            </Pill>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Diagnostics"
        footer={
          exportTargets.length > 0
            ? `A developer has pointed the engine's diagnostics at another server. Change that in ${ADVANCED_MODE_LABEL} under Diagnostics.`
            : "Technical logs stay in a folder on this Mac for a developer to look at if something goes wrong."
        }
      >
        <ListRow
          leading={<StepBadge state={exportTargets.length > 0 ? "warn" : "ok"} icon={FileText} />}
          title={
            exportTargets.length > 0
              ? `Diagnostics are sent to ${exportTargets.map(hostOf).join(", ")}`
              : "Diagnostics stay on this Mac"
          }
          subtitle={
            config ? (
              <>
                Logs folder:{" "}
                <code className="fm-code">{config.observability.logsDirectoryPath}</code>
                {config.observability.localTracingEnabled ? " · detailed tracing is on" : ""}
              </>
            ) : (
              "Connecting…"
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Your AI accounts"
        footer="Signing in to ChatGPT, Google or Claude happens on their websites. Foreman keeps the sign-in token on this Mac and never sees your password."
      >
        <ListRow
          title="What the assistants can see"
          subtitle="Only the project folder you open, and what you type. Ask me first means they stop and ask before touching anything else."
        />
      </SettingsGroup>
    </>
  );
}
