import { Wrench } from "lucide-react";
import { useState } from "react";

import { AdvancedModeSheet } from "../../../app/AdvancedModeSheet";
import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../../../brand";
import { Button } from "../../../ui/Button";
import { ListRow } from "../../../ui/ListRow";
import { StepBadge } from "../../../ui/StepBadge";
import { SettingsGroup } from "../SettingsGroup";

export function AdvancedPane() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsGroup
        title={ADVANCED_MODE_LABEL}
        footer={`Everything you do in ${PRODUCT_NAME} is also visible there, in developer language. Coming back is one click: the address ending in /simple/.`}
      >
        <ListRow
          leading={<StepBadge state="todo" icon={Wrench} />}
          title="Open the full developer interface"
          subtitle="Every file, command, model and setting. Useful when your developer is helping you."
          trailing={
            <Button size="sm" onClick={() => setOpen(true)}>
              Open {ADVANCED_MODE_LABEL}…
            </Button>
          }
        />
      </SettingsGroup>
      <AdvancedModeSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
