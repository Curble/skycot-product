import type { EnvironmentId, RuntimeMode } from "@t3tools/contracts";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../../brand";
import { AUTONOMY_LEVELS, describeAutonomyLevel } from "../../../plain/autonomy";
import { writeAutonomy } from "../../../state/preferences";
import {
  useEnsureSafeServerDefault,
  useServerDefaultRuntimeMode,
  useSkycotPolicyEnabled,
  useWriteServerDefaultRuntimeMode,
} from "../../../state/autonomy";
import { settingsHref } from "../../../router";
import { ListExtra, ListRow } from "../../../ui/ListRow";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { StepBadge } from "../../../ui/StepBadge";
import {
  autonomyForRuntimeMode,
  autonomyLevelOf,
  HARD_RULE_TITLES,
  hardRulesStatement,
  PLAIN_AUTONOMY_OPTIONS,
  runtimeModeFor,
  type Autonomy,
} from "../../compose/autonomy";
import { familyCopy } from "../../family/copy";
import { FamilyAutonomyLock } from "../../family/FamilyLock";
import { useFamily } from "../../family/FamilyProvider";
import { SettingsGroup } from "../SettingsGroup";

/**
 * Settings → Autonomy & safety. The engine's `defaultRuntimeMode` is the source of truth
 * (SEC-03): the control shows what the server will do, not what this browser remembers.
 * Only the two plain levels are offered; "Fully hands-off" is Advanced-mode only (SEC-01).
 * The hard-rules list is generated from the shared rule table and introduced with a sentence
 * that is true for this server: enforced only when it reports its policy is on.
 */
export function AutonomyPane({ environmentId }: { readonly environmentId: EnvironmentId }) {
  useEnsureSafeServerDefault(environmentId);
  const serverMode: RuntimeMode | null = useServerDefaultRuntimeMode(environmentId);
  const writeServerMode = useWriteServerDefaultRuntimeMode(environmentId);
  const policyEnforced = useSkycotPolicyEnabled(environmentId);
  const family = useFamily();

  const serverAutonomy: Autonomy | null =
    serverMode === null ? null : autonomyForRuntimeMode(serverMode);
  const handsOffOnServer = serverMode === "full-access";
  // The control can only show the plain levels; a hands-off server default is shown as a
  // warning row with a one-tap way back instead of a selected segment.
  const selected: Autonomy = family.enabled
    ? "ask-first"
    : serverAutonomy === null || serverAutonomy === "hands-off"
      ? "ask-first"
      : serverAutonomy;
  const info = AUTONOMY_LEVELS[autonomyLevelOf(selected)];

  const choose = (next: Autonomy) => {
    writeAutonomy(next);
    void writeServerMode(runtimeModeFor(next, null));
  };

  return (
    <>
      <SettingsGroup
        title="How much should the AI do on its own?"
        footer={
          family.enabled ? (
            <>
              {familyCopy.managedElsewhere.replace("Settings › Family.", "")}
              <a href={settingsHref("family")}>Settings › Family</a>.
            </>
          ) : (
            `${describeAutonomyLevel(autonomyLevelOf(selected), { policyEnforced })} ${info.hint}`
          )
        }
      >
        <ListExtra>
          <div className="fm-setting-block">
            {family.enabled ? (
              <FamilyAutonomyLock
                note={`${familyCopy.title} · ${describeAutonomyLevel("askMeFirst", { policyEnforced })}`}
              />
            ) : (
              <SegmentedControl
                label="Default autonomy"
                value={selected}
                onChange={choose}
                block
                options={PLAIN_AUTONOMY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  ...(option.tag ? { tag: option.tag } : {}),
                }))}
              />
            )}
            {handsOffOnServer && !family.enabled ? (
              <div className="fm-setting-warning" role="alert">
                <p>
                  Your Mac is currently set to <b>{AUTONOMY_LEVELS.fullyHandsOff.label}</b> (chosen
                  in {ADVANCED_MODE_LABEL}). {AUTONOMY_LEVELS.fullyHandsOff.warning}
                </p>
                <button
                  type="button"
                  className="fm-btn fm-btn--primary fm-btn--sm"
                  onClick={() => choose("ask-first")}
                >
                  Switch to {AUTONOMY_LEVELS.askMeFirst.label}
                </button>
              </div>
            ) : null}
          </div>
        </ListExtra>
      </SettingsGroup>

      <SettingsGroup
        title={`What ${PRODUCT_NAME} ${policyEnforced ? "always asks about" : "warns you about"}`}
        footer={hardRulesStatement(policyEnforced, PRODUCT_NAME)}
      >
        {HARD_RULE_TITLES.map((rule) => (
          <ListRow
            key={rule}
            leading={
              <StepBadge
                state={policyEnforced ? "ok" : "warn"}
                icon={policyEnforced ? ShieldCheck : ShieldAlert}
              />
            }
            title={rule}
          />
        ))}
      </SettingsGroup>
    </>
  );
}
