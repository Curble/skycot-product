// The title bar's calm "A new version is ready · Restart to update", shown in the Mac app once an
// update has downloaded. It never restarts by itself: it opens the restart sheet.
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { Pill } from "../../ui/Pill";
import { RestartSheet } from "./RestartSheet";
import { useDesktopUpdateState } from "./store";
import { readyVersion } from "./updates";

export function UpdatePill() {
  const state = useDesktopUpdateState();
  const [open, setOpen] = useState(false);
  if (readyVersion(state) === null) return null;
  return (
    <>
      <span className="fm-update-pill">
        <Pill
          tone="ok"
          icon={Sparkles}
          onClick={() => setOpen(true)}
          label="A new version is ready. Restart to update"
        >
          <span className="fm-update-pill__ready">A new version is ready · </span>
          <span className="fm-update-pill__long">Restart to update</span>
          <span className="fm-update-pill__short">Update</span>
        </Pill>
      </span>
      <RestartSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
