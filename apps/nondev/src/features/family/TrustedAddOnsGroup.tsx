// Settings › Family › "Trusted add-ons download by themselves": the parent's switch for the short
// list of well-known add-ons (three.js, p5.js, …) SKYCOT fetches itself, with their install
// scripts off. Changing it either way takes the parent code, checked by the engine, so a child
// can't flip it. The list itself lives in the shared rules (skycot-rules/addons).
import { Package } from "lucide-react";
import { useState } from "react";
import { describeAddOns, TRUSTED_ADD_ONS } from "@t3tools/skycot-rules/addons";

import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { Sheet } from "../../ui/Sheet";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { SettingsGroup } from "../settings/SettingsGroup";
import { useFamily } from "./FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "./ParentCodeEntry";
import { setTrustedAddOns } from "./store";

export const TRUSTED_ADD_ONS_TITLE = "Trusted add-ons download by themselves";

/** The row's line under the title. */
export function trustedAddOnsLine(on: boolean): string {
  return on
    ? "On. SKYCOT fetches these itself, with their install scripts off, and the recap lists each one. Any other add-on still asks a grown-up."
    : "Off. Every add-on asks a grown-up first.";
}

export function TrustedAddOnsGroup() {
  const { profile } = useFamily();
  const [wanted, setWanted] = useState<boolean | null>(null);
  const entry = useParentCodeEntry(
    (code) => setTrustedAddOns(wanted ?? profile.trustedAddOns, code),
    () => setWanted(null),
  );
  return (
    <>
      <SettingsGroup
        title="Add-ons"
        footer={`The trusted add-ons: ${describeAddOns(TRUSTED_ADD_ONS.map((addOn) => addOn.name))}. They come only from npm or its two big download sites (jsDelivr and unpkg).`}
      >
        <ListRow
          leading={<StepBadge state={profile.trustedAddOns ? "ok" : "todo"} icon={Package} />}
          title={`${TRUSTED_ADD_ONS_TITLE} (parent code)`}
          subtitle={trustedAddOnsLine(profile.trustedAddOns)}
          trailing={
            <Switch
              checked={profile.trustedAddOns}
              onChange={(on) => setWanted(on)}
              label={TRUSTED_ADD_ONS_TITLE}
            />
          }
        />
      </SettingsGroup>
      <Sheet
        open={wanted !== null}
        onClose={() => setWanted(null)}
        icon={Package}
        iconTone="grey"
        title={wanted ? "Let trusted add-ons download by themselves?" : "Ask before every add-on?"}
        description="Enter the parent code to change this."
        sober
        dismissOnBackdrop={false}
        actions={
          <>
            <Button onClick={() => setWanted(null)} disabled={entry.busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!entry.canSubmit}
              onClick={() => void entry.submit()}
            >
              {entry.busy ? "Checking…" : wanted ? "Turn on" : "Turn off"}
            </Button>
          </>
        }
      >
        {wanted !== null ? <ParentCodeEntry entry={entry} autoFocus /> : null}
      </Sheet>
    </>
  );
}
