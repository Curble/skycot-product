import { Wrench } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../brand";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { openAdvancedMode } from "./platform";

/**
 * Confirms before leaving for the full developer interface. Every exit from
 * SKYCOT goes through this sheet so the way back is always explained.
 */
export function AdvancedModeSheet({
  open,
  onClose,
  path = "",
  reason,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Where in the developer interface to land, e.g. "settings/connections". */
  readonly path?: string;
  /** One sentence on why this task lives there, shown before the standard explanation. */
  readonly reason?: string;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={Wrench}
      iconTone="grey"
      title={`Open ${ADVANCED_MODE_LABEL}?`}
      description={
        <>
          {reason ? <>{reason} </> : null}
          {ADVANCED_MODE_LABEL} is the full developer interface: every file, command and setting, in
          developer language. Your conversations and projects are the same in both. To come back,
          use <b>Back to {PRODUCT_NAME}</b> at the bottom of its sidebar.
        </>
      }
      actions={
        <>
          <Button onClick={onClose}>Stay here</Button>
          <Button variant="primary" onClick={() => openAdvancedMode(path)}>
            Open {ADVANCED_MODE_LABEL}
          </Button>
        </>
      }
    />
  );
}
