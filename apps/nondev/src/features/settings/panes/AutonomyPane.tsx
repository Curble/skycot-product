import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";

import { CREW_NAME } from "../../../brand";
import { AUTONOMY_LEVELS } from "../../../plain/autonomy";
import { readAutonomy, writeAutonomy } from "../../../state/preferences";
import { serverEnvironment } from "../../../state/server";
import { ListRow } from "../../../ui/ListRow";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { StepBadge } from "../../../ui/StepBadge";
import {
  ALWAYS_ASKS,
  AUTONOMY_OPTIONS,
  runtimeModeFor,
  type Autonomy,
} from "../../compose/autonomy";
import { useHandsOffMinutes, writeHandsOffMinutes } from "../localPrefs";
import { SettingsGroup } from "../SettingsGroup";

const LEVEL_INFO: Record<Autonomy, (typeof AUTONOMY_LEVELS)[keyof typeof AUTONOMY_LEVELS]> = {
  "ask-first": AUTONOMY_LEVELS.askMeFirst,
  carefully: AUTONOMY_LEVELS.justDoItCarefully,
  "hands-off": AUTONOMY_LEVELS.fullyHandsOff,
};

/** The hard-rules sentence as rows, with the trailing full stop dropped. */
export const HARD_RULES: ReadonlyArray<string> = ALWAYS_ASKS.replace(/\.$/, "")
  .split(/,\s*|\s+or\s+/)
  .map((rule) => rule.trim())
  .filter((rule) => rule.length > 0)
  .map((rule) => rule.charAt(0).toUpperCase() + rule.slice(1));

export function AutonomyPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [autonomy, setAutonomy] = useState<Autonomy>(readAutonomy);
  const timeBox = AUTONOMY_LEVELS.fullyHandsOff.timeBox!;
  const minutes = useHandsOffMinutes(timeBox.defaultMinutes);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const info = LEVEL_INFO[autonomy];

  const choose = (next: Autonomy) => {
    setAutonomy(next);
    writeAutonomy(next);
    // Keep the engine's own default in step so automations and the developer
    // UI start from the same place as new conversations here.
    const runtimeMode = runtimeModeFor(next, null);
    if (settings && settings.defaultRuntimeMode !== runtimeMode) {
      void updateSettings({ environmentId, input: { patch: { defaultRuntimeMode: runtimeMode } } });
    }
  };

  return (
    <>
      <SettingsGroup
        title="How much should the AI do on its own?"
        footer={`${info.description} ${info.hint}`}
      >
        <div className="fm-setting-block">
          <SegmentedControl
            label="Default autonomy"
            value={autonomy}
            onChange={choose}
            block
            options={AUTONOMY_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              ...(option.tag ? { tag: option.tag } : {}),
            }))}
          />
          {info.warning ? <p className="fm-setting-warning">{info.warning}</p> : null}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Hands-off timer"
        footer="Fully hands-off switches itself back to Ask me first when the timer runs out, even mid-task."
      >
        <ListRow
          title="Switch off after"
          subtitle="Applies every time you choose Fully hands-off."
          trailing={
            <select
              className="fm-select"
              aria-label="Hands-off timer"
              value={String(minutes)}
              onChange={(event) => writeHandsOffMinutes(Number(event.currentTarget.value))}
            >
              {timeBox.choicesMinutes.map((choice) => (
                <option key={choice} value={String(choice)}>
                  {choice < 60
                    ? `${choice} minutes`
                    : choice === 60
                      ? "1 hour"
                      : `${choice / 60} hours`}
                </option>
              ))}
            </select>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={`${CREW_NAME} always asks before`}
        footer="These can't be switched off. Each time is a fresh question, whatever the autonomy level."
      >
        {HARD_RULES.map((rule) => (
          <ListRow key={rule} leading={<StepBadge state="ok" icon={ShieldCheck} />} title={rule} />
        ))}
      </SettingsGroup>
    </>
  );
}
