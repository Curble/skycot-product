import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { EyeOff, FileText, Mic } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../../brand";
import { serverEnvironment } from "../../../state/server";
import { ListRow } from "../../../ui/ListRow";
import { Pill } from "../../../ui/Pill";
import { StepBadge } from "../../../ui/StepBadge";
import { speechService } from "../../voice/browser";
import { voiceCopy, whereVoiceGoes } from "../../voice/copy";
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
        footer={`${PRODUCT_NAME} never sends your files, messages or projects. It only sends anonymous daily totals, so there is no switch to flip.`}
      >
        <ListRow
          leading={<StepBadge state="ok" icon={EyeOff} />}
          title="Daily totals"
          subtitle={
            relayTelemetry
              ? "The desktop app's relay diagnostics are on; the simple interface sends only the daily totals described here."
              : "SKYCOT sends anonymous daily totals for successful update checks and relay connections. The count changes each UTC day and has no name or account attached. It contains no project or message content. Do Not Track or Global Privacy Control opts out of update counting; turn off updates or the relay to stop those requests."
          }
          trailing={
            <Pill tone="ok" size="sm">
              Limited
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

      <SettingsGroup title="Voice" footer={voiceCopy.readAloudLocal}>
        <ListRow
          leading={<StepBadge state={speechService === "none" ? "ok" : "warn"} icon={Mic} />}
          title={
            speechService === "none"
              ? "Voice typing is off in this window"
              : "Voice typing uses the browser's speech service"
          }
          subtitle={
            speechService === "none"
              ? whereVoiceGoes(speechService)
              : `${whereVoiceGoes(speechService)} Only while the microphone button is lit.`
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Your AI accounts"
        footer="Signing in to ChatGPT, Google or Claude happens on their websites. SKYCOT keeps the sign-in token on this Mac and never sees your password."
      >
        <ListRow
          title="What the assistants can see"
          subtitle="Only the project folder you open, and what you type. Ask me first means they stop and ask before touching anything else."
        />
      </SettingsGroup>
    </>
  );
}
