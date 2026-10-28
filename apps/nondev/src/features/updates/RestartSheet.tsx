// "Restart to update": what is new, what a restart does to work in progress, and the restart
// itself. With the Family profile on, the parent code comes first and the Mac app refuses the
// restart without the engine's say-so (apps/desktop/src/skycot/updates.ts).
import { useAtomValue } from "@effect/atom-react";
import { RotateCw } from "lucide-react";
import { useState } from "react";

import { PRODUCT_NAME } from "../../brand";
import { conversationRowsAtom } from "../../state/conversations";
import { useCrew } from "../../themes/useCrew";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useFamily } from "../family/FamilyProvider";
import { refreshFamily } from "../family/store";
import { updatesApi } from "./api";
import { installDownloadedUpdate, useDesktopUpdateState } from "./store";
import { plainReleaseNotes, readyVersion, runningWarning } from "./updates";

export const COULD_NOT_CONFIRM = `${PRODUCT_NAME} couldn't confirm grown-up mode. Enter the parent code to restart.`;
const COULD_NOT_RESTART = `${PRODUCT_NAME} couldn't restart just now. Try again in a moment.`;

/** How many conversations the crew is working on right now (a restart pauses them). */
function useRunningCount(): number {
  const rows = useAtomValue(conversationRowsAtom);
  return rows.filter((row) => row.status.kind === "working" || row.status.kind === "preparing")
    .length;
}

export function RestartSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const state = useDesktopUpdateState();
  const family = useFamily();
  const crew = useCrew();
  const running = useRunningCount();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const version = readyVersion(state);
  if (state === null || version === null) return null;

  const notes = plainReleaseNotes(state, version);
  const warning = runningWarning(running, crew.builder.name);

  const close = () => {
    setProblem(null);
    onClose();
  };

  const restart = async () => {
    setProblem(null);
    // The code sheet comes first, so this one does not say "Restarting…" behind it.
    if (family.enabled && !(await family.requireParentCode("restartToUpdate"))) {
      // Never silent: say what is needed (grown-up mode, then the code sheet, both came up empty).
      setProblem(COULD_NOT_CONFIRM);
      return;
    }
    setBusy(true);
    try {
      let allowed = await updatesApi.allowRestart(version);
      if (!allowed.ok && allowed.reason === "forbidden") {
        // The profile was turned on elsewhere since this window last looked.
        await refreshFamily();
        if (!(await family.requireParentCode("restartToUpdate"))) {
          setProblem(COULD_NOT_CONFIRM);
          return;
        }
        allowed = await updatesApi.allowRestart(version);
      }
      if (!allowed.ok) {
        setProblem(allowed.message);
        return;
      }
      // On success the Mac app quits here and opens again on the new version.
      if (!(await installDownloadedUpdate())) setProblem(COULD_NOT_RESTART);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      icon={RotateCw}
      iconTone="blue"
      title="Restart to update"
      description={`Version ${version} is ready. ${PRODUCT_NAME} closes for a moment and opens again with it.`}
      initialFocus="first"
      actions={
        <>
          <Button onClick={close} disabled={busy}>
            Later
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void restart()}>
            {busy ? "Restarting…" : warning ? "Restart anyway" : "Restart now"}
          </Button>
        </>
      }
      note={problem}
    >
      {notes.length > 0 ? (
        <section className="fm-update-notes" aria-label="What's new">
          <h4 className="fm-update-notes__title">What's new</h4>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={warning ? "fm-update-warning" : "fm-update-line"}>
        {warning ?? "Unfinished conversations pick up where they left off after the restart."}
      </p>
      {family.enabled ? (
        <p className="fm-update-line">A grown-up's parent code is needed to restart.</p>
      ) : null}
    </Sheet>
  );
}
