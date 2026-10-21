import { History } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { PRIVATE_COPY_COPY } from "./privateCopy";

export interface TrackingChoice {
  readonly confirmed: boolean;
  /** Write the starter ignore list before the first version. */
  readonly starterIgnore: boolean;
}

/**
 * Asked once, before the first message in a folder with no history: nothing
 * is written to the person's folder (a `.git` folder, a first version of
 * every file) until they have read what will happen and said yes.
 */
export function TrackingSheet({
  projectTitle,
  onChoose,
}: {
  readonly projectTitle: string;
  readonly onChoose: (choice: TrackingChoice) => void;
}) {
  const [starterIgnore, setStarterIgnore] = useState(true);
  const copy = PRIVATE_COPY_COPY.tracking;
  return (
    <Sheet
      open
      onClose={() => onChoose({ confirmed: false, starterIgnore })}
      icon={History}
      title={copy.title}
      description={copy.body(projectTitle)}
      dismissOnBackdrop={false}
      actions={
        <>
          <Button onClick={() => onChoose({ confirmed: false, starterIgnore })}>
            {copy.cancel}
          </Button>
          <Button variant="primary" onClick={() => onChoose({ confirmed: true, starterIgnore })}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <label className="fm-browse__toggle" style={{ alignItems: "flex-start", gap: 10 }}>
        <input
          type="checkbox"
          checked={starterIgnore}
          onChange={(event) => setStarterIgnore(event.currentTarget.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          <b style={{ color: "var(--fm-label)", fontWeight: 600 }}>{copy.ignoreLabel}</b>
          <br />
          {copy.ignoreHint}
        </span>
      </label>
    </Sheet>
  );
}
