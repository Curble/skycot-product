/**
 * "SKYCOT is asleep": bedtime, today's time or messages used up, or leaving the AI allowance
 * for the grown-ups. The Mac decides; this only says so, calmly, with the sleeping mascot, and
 * offers "Ask a grown-up for more time" (the parent code, on this device).
 */
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { asleepCopy } from "../../../../nondev/src/features/family-limits/limits";
import { useChild } from "../../app/child/ChildContext";
import { useMacData } from "../../data/MacData";
import { familyApi, type MoreTimeKind } from "../../family/api";
import type { Mac } from "../../links/store";
import { Button, Mascot, ParentCodeField, Segmented, Sheet, Txt, haptic } from "../../ui/kit";
import { useTheme } from "../../ui/theme";

/** The Mac every linked Mac agrees is asleep for this child, or null while any is awake. */
export function useAsleep(): Mac | null {
  const child = useChild();
  if (child.macs.length === 0) return null;
  const asleep = child.macs.filter((mac) => child.sessionOn(mac)?.limits?.asleep === true);
  return asleep.length === child.macs.length ? asleep[0]! : null;
}

export function AsleepCover(props: { readonly mac: Mac }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const child = useChild();
  const { refresh } = useMacData();
  const [asking, setAsking] = useState(false);
  const session = child.sessionOn(props.mac);
  const me = child.childOn(props.mac);
  const limits = session?.limits ?? null;
  if (limits === null) return null;
  const copy = asleepCopy(
    limits,
    me?.limits ?? null,
    me?.name ?? null,
    Date.now(),
    child.timeZoneOn(props.mac),
  );
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.dark ? "#171A45" : "#EEF0FF",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: 32,
        gap: 16,
      }}
      accessibilityViewIsModal
    >
      <Mascot pose="night-night" size={170} />
      <Txt variant="largeTitle" center style={{ color: theme.dark ? "#FFF4DC" : "#171A45" }}>
        {copy.title}
      </Txt>
      <Txt center style={{ color: theme.dark ? "#FFF4DC" : "#3C3486", maxWidth: 440 }}>
        {copy.body}
      </Txt>
      <Button
        title="Ask a grown-up for more time"
        kind="tinted"
        onPress={() => setAsking(true)}
        style={{ marginTop: 12, minWidth: 280 }}
      />
      <MoreTimeSheet
        visible={asking}
        mac={props.mac}
        childId={me?.id ?? null}
        bedtime={limits.reason === "bedtime"}
        onClose={() => setAsking(false)}
        onGiven={async () => {
          setAsking(false);
          await refresh(props.mac.macId);
        }}
      />
    </View>
  );
}

function MoreTimeSheet(props: {
  readonly visible: boolean;
  readonly mac: Mac;
  readonly childId: string | null;
  readonly bedtime: boolean;
  readonly onClose: () => void;
  readonly onGiven: () => void;
}) {
  const [kind, setKind] = useState<MoreTimeKind>("extra15");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options: Array<{ id: MoreTimeKind; label: string }> = [
    { id: "extra15", label: "15 minutes" },
    { id: "extra30", label: "30 minutes" },
    ...(props.bedtime ? [{ id: "endBedtime" as const, label: "No bedtime tonight" }] : []),
  ];
  const give = async () => {
    if (props.childId === null || code.length < 4) return;
    setBusy(true);
    const result = await familyApi.moreTime(props.mac.transport, {
      childId: props.childId,
      kind,
      code,
    });
    setBusy(false);
    setCode("");
    if (!result.ok) {
      haptic("warning");
      setProblem(result.message);
      return;
    }
    haptic("success");
    setProblem(null);
    props.onGiven();
  };
  return (
    <Sheet visible={props.visible} title="More time" onClose={props.onClose}>
      <Txt tone="label2">For a grown-up: how much more?</Txt>
      <Segmented
        accessibilityLabel="How much more time"
        options={options}
        value={kind}
        onChange={setKind}
      />
      <ParentCodeField value={code} onChange={setCode} onSubmit={give} problem={problem} />
      <Button
        title={busy ? "Checking…" : "Wake SKYCOT"}
        busy={busy}
        disabled={code.length < 4}
        onPress={give}
      />
      <Txt variant="footnote" tone="label2" center>
        Every bit of extra time shows in Settings › Family on the Mac.
      </Txt>
    </Sheet>
  );
}
