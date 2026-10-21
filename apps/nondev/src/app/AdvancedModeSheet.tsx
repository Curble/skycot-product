import { Wrench } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../brand";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { advancedModeUrl } from "./platform";

/** Confirms before leaving for the full developer interface. */
export function AdvancedModeSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
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
          {ADVANCED_MODE_LABEL} opens the full developer interface: every file, command and setting,
          in developer language. Your conversations and projects are the same in both. You can come
          back to {PRODUCT_NAME} any time from the address{" "}
          <code style={{ fontFamily: "var(--fm-mono)" }}>/simple/</code>.
        </>
      }
      actions={
        <>
          <Button onClick={onClose}>Stay here</Button>
          <Button variant="primary" onClick={() => window.location.assign(advancedModeUrl())}>
            Open {ADVANCED_MODE_LABEL}
          </Button>
        </>
      }
    />
  );
}
