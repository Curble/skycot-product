// Settings › Family on the family's Mac: "Reach this Mac from anywhere" (SKYCOT Relay). One row
// with a switch, the state in plain words, and a confirmation sheet before it goes on. Changing
// it asks for the parent code, like every other Family setting.
import { Globe, LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { Sheet } from "../../ui/Sheet";
import { StepBadge } from "../../ui/StepBadge";
import { Switch } from "../../ui/Switch";
import { SettingsGroup } from "../settings/SettingsGroup";
import { familyApi } from "./api";
import { useFamily } from "./FamilyProvider";
import { RELAY_FOOTER, RELAY_TITLE, relaySummary, type RelayStatus } from "./relay";

import "./people.css";

const REFRESH_MS = 5_000;

export function RelayGroup() {
  const { requireParentCode } = useFamily();
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = useCallback(
    () =>
      void familyApi.relay().then((result) => {
        if (result.ok) setStatus(result.value);
      }),
    [],
  );
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const change = async (enabled: boolean) => {
    setProblem(null);
    if (!(await requireParentCode("manageChildren"))) return;
    setBusy(true);
    const result = await familyApi.setRelay({ enabled });
    setBusy(false);
    setConfirming(false);
    if (result.ok) setStatus(result.value);
    else setProblem(result.message);
  };

  const summary = relaySummary(status);
  return (
    <>
      <SettingsGroup title="Away from home" footer={RELAY_FOOTER}>
        <ListRow
          leading={<StepBadge state={summary.badge} icon={Globe} />}
          title={<span id="fm-relay-title">{RELAY_TITLE}</span>}
          subtitle={summary.subtitle}
          trailing={
            <Switch
              checked={summary.switchOn}
              disabled={summary.switchDisabled || busy}
              labelledBy="fm-relay-title"
              label={RELAY_TITLE}
              onChange={(next) => (next ? setConfirming(true) : void change(false))}
            />
          }
        />
        {problem ? <Banner tone="warning">{problem}</Banner> : null}
      </SettingsGroup>
      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        icon={LockKeyhole}
        title="Reach this Mac from anywhere?"
        description="Phones and iPads you link can then use SKYCOT away from home, through SKYCOT Relay."
        sober
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Not now</Button>
            <Button variant="primary" disabled={busy} onClick={() => void change(true)}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
          </>
        }
      >
        <ul className="fm-relay-points">
          <li>Everything is sealed on your devices and on this Mac. The relay can't read it.</li>
          <li>
            Each device works only as the person it was linked for, with the same rules as at home.
          </li>
          <li>Remove a device here and it stops at once, at home and away.</li>
          <li>Devices linked before need linking once more to work away from home.</li>
          <li>This Mac has to be on and awake for them to reach it.</li>
        </ul>
      </Sheet>
    </>
  );
}
