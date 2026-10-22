import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { familyCopy } from "../family/copy";
import { useFamily } from "../family/FamilyProvider";
import { ListRow } from "../../ui/ListRow";
import { SettingsGroup } from "../settings/SettingsGroup";
import { UsageDetails } from "./UsageSheet";
import { useActiveUsage } from "./useUsage";

/**
 * Usage inside Settings › AI assistants. With the Family profile on, the title-bar ring, its
 * popover, the banner and the sheet are hidden from the child, and this is where the parent
 * sees the same figures, after the parent code.
 */
export function UsageSettingsGroup({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const family = useFamily();
  const { providers, active } = useActiveUsage();
  const [revealed, setRevealed] = useState(false);

  if (family.enabled && !revealed) {
    return (
      <SettingsGroup
        title="Usage"
        footer={`Hidden from the child's view by the ${familyCopy.title}.`}
      >
        <ListRow
          title="Show usage"
          subtitle="How much of each assistant's allowance is left, and what the last week used. Asks for the parent code."
          chevron
          onClick={() => {
            void family.requireParentCode("aiSettings").then((ok) => {
              if (ok) setRevealed(true);
            });
          }}
        />
      </SettingsGroup>
    );
  }

  return (
    <section className="fm-group" aria-labelledby="fm-usage-settings-title">
      <h3 id="fm-usage-settings-title" className="fm-group__title">
        Usage
      </h3>
      <div className="fm-usage-settings">
        <UsageDetails
          environmentId={environmentId}
          providers={providers}
          activeInstanceId={active ? String(active.instanceId) : null}
        />
      </div>
    </section>
  );
}
