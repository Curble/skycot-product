import { Wrench } from "lucide-react";

import { ADVANCED_MODE_LABEL, PRODUCT_NAME } from "../brand";
import { familyCopy } from "../features/family/copy";
import { useFamily } from "../features/family/FamilyProvider";
import { ParentCodeEntry, useParentCodeEntry } from "../features/family/ParentCodeEntry";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { openAdvancedMode } from "./platform";

/**
 * Confirms before leaving for the full developer interface. Every exit from
 * SKYCOT goes through this sheet so the way back is always explained, and
 * with the Family profile on it is also where the parent code is asked.
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
  const family = useFamily();
  const locked = family.isLocked("advancedMode");
  const entry = useParentCodeEntry(() => openAdvancedMode(path));
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
          {locked ? <> With the {familyCopy.title} on, a parent enters the code first.</> : null}
        </>
      }
      sober={locked}
      initialFocus={locked ? "first" : "body"}
      actions={
        <>
          <Button onClick={onClose}>Stay here</Button>
          {locked ? (
            <Button
              variant="primary"
              disabled={!entry.canSubmit}
              onClick={() => void entry.submit()}
            >
              {entry.busy ? "Checking…" : `Open ${ADVANCED_MODE_LABEL}`}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => openAdvancedMode(path)}>
              Open {ADVANCED_MODE_LABEL}
            </Button>
          )}
        </>
      }
    >
      {locked ? <ParentCodeEntry entry={entry} /> : null}
    </Sheet>
  );
}
