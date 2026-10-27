import { useFamily } from "./FamilyProvider";
import { ListRow } from "../../ui/ListRow";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { SettingsGroup } from "../settings/SettingsGroup";
import { useFamilyCertificatesOn, writeFamilyCertificatesOn } from "../settings/localPrefs";

/** The parent-code switch can hide certificates and restore them on this Mac. */
export function FamilyCertificateGroup() {
  const { requireParentCode } = useFamily();
  const on = useFamilyCertificatesOn();
  return (
    <SettingsGroup
      title="Certificates"
      footer="This choice applies on this Mac. A parent can turn certificates back on here."
    >
      <ListRow
        leading={<StepBadge state={on ? "ok" : "todo"} />}
        title="Printable certificates"
        subtitle={
          on
            ? "Children can print a certificate from the sticker book."
            : "Hidden from the sticker book."
        }
        trailing={
          <Switch
            checked={on}
            onChange={(next) =>
              void requireParentCode("voiceSettings").then((ok) => {
                if (ok) writeFamilyCertificatesOn(next);
              })
            }
            label="Printable certificates"
          />
        }
      />
    </SettingsGroup>
  );
}
