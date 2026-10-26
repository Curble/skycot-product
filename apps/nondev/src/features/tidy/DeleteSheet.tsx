import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";

import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { TextField } from "../../ui/TextField";
import { useFamily } from "../family/FamilyProvider";
import { deleteSheetCopy } from "./tidy";
import { useTidy } from "./useTidy";

/**
 * "Delete…": the one tidy action with no Undo, so it gets a sheet like the Mac's own: what
 * goes, what stays, "This can't be undone", Cancel chosen first and a red Delete. In a
 * Family profile the red button opens the parent-code sheet over this one.
 */
export function DeleteSheet({
  shell,
  currentTitle,
  archived = false,
  onClose,
}: {
  /** Null keeps the sheet closed. */
  readonly shell: EnvironmentThreadShell | null;
  /** The name the list shows now. */
  readonly currentTitle: string;
  readonly archived?: boolean;
  readonly onClose: () => void;
}) {
  if (shell === null) return null;
  return (
    <DeleteSheetBody
      shell={shell}
      currentTitle={currentTitle}
      archived={archived}
      onClose={onClose}
    />
  );
}

function DeleteSheetBody({
  shell,
  currentTitle,
  archived,
  onClose,
}: {
  readonly shell: EnvironmentThreadShell;
  readonly currentTitle: string;
  readonly archived: boolean;
  readonly onClose: () => void;
}) {
  const tidy = useTidy();
  const family = useFamily();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const copy = deleteSheetCopy({ title: currentTitle, archived, family: family.enabled });

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    const outcome = await tidy.remove(
      shell,
      { archived, title: currentTitle },
      family.enabled ? code : undefined,
    );
    setBusy(false);
    if (outcome.kind === "deleted") onClose();
    else if (outcome.kind === "failed") setProblem(outcome.message);
    else if (family.enabled) setProblem("That wasn't the parent code. Try again.");
  };

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      icon={Trash2}
      iconTone="red"
      title={copy.title}
      description={copy.goes}
      sober
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            filled
            onClick={() => void remove()}
            disabled={busy || (family.enabled && !/^\d{4,6}$/.test(code))}
          >
            {busy ? "Deleting…" : copy.button}
          </Button>
        </>
      }
    >
      <ul className="fm-delete-stays" aria-label="What stays">
        {copy.stays.map((line) => (
          <li key={line}>
            <Check size={14} strokeWidth={2.2} aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {copy.alternative ? <p className="fm-help fm-delete-alt">{copy.alternative}</p> : null}
      {family.enabled ? (
        <TextField
          label="Parent code"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, ""))}
        />
      ) : null}
      <p className="fm-delete-final">{copy.final}</p>
      {problem ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warning">{problem}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
