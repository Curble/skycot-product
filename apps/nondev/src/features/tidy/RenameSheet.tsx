import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { TextField } from "../../ui/TextField";
import { cleanTitle, MAX_TITLE_LENGTH } from "./tidy";
import { useTidy } from "./useTidy";

/**
 * "Rename…": a small sheet with the name selected, so typing replaces it. Return saves,
 * Escape or Cancel leaves it as it was, and an empty name is refused rather than saved.
 */
export function RenameSheet({
  shell,
  currentTitle,
  archived = false,
  onClose,
}: {
  /** Null keeps the sheet closed. */
  readonly shell: EnvironmentThreadShell | null;
  /** The name the list shows now (the first message when the engine has none yet). */
  readonly currentTitle: string;
  readonly archived?: boolean;
  readonly onClose: () => void;
}) {
  if (shell === null) return null;
  return (
    <RenameSheetBody
      shell={shell}
      currentTitle={currentTitle}
      archived={archived}
      onClose={onClose}
    />
  );
}

function RenameSheetBody({
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
  const [value, setValue] = useState(currentTitle);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  const checked = cleanTitle(value);

  const save = async () => {
    if (!checked.ok) {
      setProblem(checked.reason);
      return;
    }
    setBusy(true);
    const outcome = await tidy.rename(shell, value, { archived });
    setBusy(false);
    if (!outcome.ok) {
      setProblem(outcome.message);
      return;
    }
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={Pencil}
      title="Rename this conversation"
      description="The new name shows in the list, at the top of the conversation and on the fridge."
      initialFocus="first"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !checked.ok}>
            {busy ? "Saving…" : "Rename"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Name"
          inputRef={inputRef}
          value={value}
          maxLength={MAX_TITLE_LENGTH}
          autoComplete="off"
          spellCheck
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setProblem(null);
          }}
        />
      </form>
      {problem === null && !checked.ok ? (
        <p className="fm-help" style={{ marginTop: 8 }}>
          {checked.reason}
        </p>
      ) : null}
      {problem ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="warning">{problem}</Banner>
        </div>
      ) : null}
    </Sheet>
  );
}
