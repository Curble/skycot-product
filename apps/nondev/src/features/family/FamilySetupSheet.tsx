// Settings › Family → "Set up Family profile": the same form as the welcome
// step, in its own sheet, for a parent who skipped it the first time.
import type { EnvironmentId } from "@t3tools/contracts";
import { Users } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useEnableFamilyWithDefaults } from "./applyDefaults";
import { familyCopy } from "./copy";
import { EMPTY_SETUP_DRAFT, setupReady, type FamilySetupDraft } from "./family";
import { FamilySetupForm } from "./FamilySetupForm";

export function FamilySetupSheet({
  open,
  onClose,
  environmentId,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
}) {
  if (!open) return null;
  return <FamilySetupSheetBody onClose={onClose} environmentId={environmentId} />;
}

// Mounted only while open so every open starts with an empty form.
function FamilySetupSheetBody({
  onClose,
  environmentId,
}: {
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
}) {
  const [draft, setDraft] = useState<FamilySetupDraft>(EMPTY_SETUP_DRAFT);
  const [busy, setBusy] = useState(false);
  const enable = useEnableFamilyWithDefaults(environmentId);
  const finish = async () => {
    if (!setupReady(draft) || busy) return;
    setBusy(true);
    await enable({ childName: draft.childName, code: draft.code });
    setBusy(false);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      icon={Users}
      iconTone="orange"
      title={`Set up the ${familyCopy.title}`}
      description="For a child you look after. The Workshop look comes on, the assistant always asks first, and a parent code guards publishing, automations and the developer tools."
      wide
      initialFocus="first"
      dismissOnBackdrop={false}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!setupReady(draft) || busy}
            onClick={() => void finish()}
          >
            {busy ? "Turning on…" : `Turn on the ${familyCopy.title}`}
          </Button>
        </>
      }
    >
      <FamilySetupForm draft={draft} onDraft={setDraft} autoFocus />
    </Sheet>
  );
}
