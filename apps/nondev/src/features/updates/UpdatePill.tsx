// The title bar's calm "A new version is ready · Restart to update", shown in the Mac app once an
// update has downloaded. It never restarts by itself: it opens the restart sheet (so does the
// "new version ready" notification, ./ReadyNotifier.tsx).
import { Sparkles } from "lucide-react";

import { Pill } from "../../ui/Pill";
import { RestartSheet } from "./RestartSheet";
import {
  closeRestartSheet,
  openRestartSheet,
  useDesktopUpdateState,
  useRestartSheetOpen,
} from "./store";
import { readyVersion } from "./updates";
import { useChildView } from "../../app/useChildView";

export function UpdatePill() {
  const state = useDesktopUpdateState();
  const childView = useChildView();
  const open = useRestartSheetOpen();
  if (childView || readyVersion(state) === null) return null;
  return (
    <>
      <span className="fm-update-pill">
        <Pill
          tone="ok"
          icon={Sparkles}
          onClick={openRestartSheet}
          label="A new version is ready. Restart to update"
        >
          <span className="fm-update-pill__ready">A new version is ready · </span>
          <span className="fm-update-pill__long">Restart to update</span>
          <span className="fm-update-pill__short">Update</span>
        </Pill>
      </span>
      <RestartSheet open={open} onClose={closeRestartSheet} />
    </>
  );
}
