// Settings → About → Updates. In the Mac app: the updater's state in plain words, "Check for
// updates", and "Restart to update" once a new version is ready. In a browser: only what the
// engine can honestly know (usually nothing, so the version line above is all there is).
import { CircleCheck, CloudDownload, RotateCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { ProgressBar } from "../../ui/ProgressBar";
import { StepBadge, type StepBadgeState } from "../../ui/StepBadge";
import { useFamily } from "../family/FamilyProvider";
import { SettingsGroup } from "../settings/SettingsGroup";
import { updatesApi } from "./api";
import { RestartSheet } from "./RestartSheet";
import { checkForUpdate, hasDesktopUpdater, retryDownload, useDesktopUpdateState } from "./store";
import {
  browserUpdateView,
  desktopUpdateView,
  type EngineUpdates,
  type UpdateView,
} from "./updates";

const BADGE: Record<UpdateView["tone"], { state: StepBadgeState; icon: typeof Sparkles }> = {
  quiet: { state: "todo", icon: CloudDownload },
  ok: { state: "ok", icon: CircleCheck },
  busy: { state: "todo", icon: CloudDownload },
  ready: { state: "done", icon: Sparkles },
  warn: { state: "warn", icon: TriangleAlert },
};

function useEngineUpdates(enabled: boolean): EngineUpdates | null {
  const [engine, setEngine] = useState<EngineUpdates | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void updatesApi.status().then((result) => {
      if (!cancelled && result.ok) setEngine(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return engine;
}

export function AboutUpdates() {
  const desktop = hasDesktopUpdater();
  const state = useDesktopUpdateState();
  const engine = useEngineUpdates(!desktop);
  const family = useFamily();
  const [restartOpen, setRestartOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  // A render-time clock only for "Checked today at 9:41".
  const [now] = useState(() => new Date());

  const view = desktop
    ? state === null
      ? null
      : desktopUpdateView(state, now)
    : browserUpdateView(engine);
  if (view === null) return null;

  const check = async () => {
    setChecking(true);
    try {
      await checkForUpdate();
    } finally {
      setChecking(false);
    }
  };

  let trailing: ReactNode = null;
  if (view.action === "check") {
    trailing = (
      <Button size="sm" disabled={checking} onClick={() => void check()}>
        {checking ? "Checking…" : "Check for updates"}
      </Button>
    );
  } else if (view.action === "retry-download") {
    trailing = (
      <Button size="sm" onClick={() => void retryDownload()}>
        Try again
      </Button>
    );
  } else if (view.action === "restart") {
    trailing = (
      <Button size="sm" variant="primary" icon={RotateCw} onClick={() => setRestartOpen(true)}>
        Restart to update
      </Button>
    );
  }

  const badge = BADGE[view.tone];
  // Only once updates can arrive: with no feed the headline already says all there is.
  const footer =
    desktop && state?.enabled
      ? family.enabled
        ? "Anyone can check. Restarting into a new version needs the parent code."
        : "New versions download in the background. Nothing changes until you restart."
      : undefined;

  return (
    <SettingsGroup title="Updates" {...(footer ? { footer } : {})}>
      <ListRow
        leading={<StepBadge state={badge.state} icon={badge.icon} />}
        title={view.headline}
        subtitle={
          view.progress !== null ? (
            <span className="fm-update-progress">
              {view.detail ? <span>{view.detail}</span> : null}
              <ProgressBar value={view.progress} max={100} thin label="Download progress" />
            </span>
          ) : (
            view.detail
          )
        }
        trailing={trailing}
      />
      {desktop ? <RestartSheet open={restartOpen} onClose={() => setRestartOpen(false)} /> : null}
    </SettingsGroup>
  );
}
