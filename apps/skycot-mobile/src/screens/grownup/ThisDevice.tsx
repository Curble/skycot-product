/**
 * This device, on a grown-up's phone: Face ID (waits for SKYCOT Relay's secure address; the
 * parent code works meanwhile), Apple Watch (say yes from the wrist, Phase 4), Lock everything
 * (ends every grown-up's yes on every device), the linked Macs, About, and Unlink this device.
 * Phase 1's copy throughout.
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";

import type { StackRoutes } from "../../app/routes";
import { useGrownUp } from "../../app/grownup/GrownUpContext";
import { useSharedCodeLength } from "../../data/MacData";
import { familyApi } from "../../family/api";
import { passkeySupport } from "../../family/passkey";
import { useLinks, type Mac } from "../../links/store";
import {
  Button,
  Page,
  ParentCodeSheet,
  Row,
  RowIcon,
  Section,
  Sheet,
  Txt,
  haptic,
} from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { useWatch } from "../../watch/WatchBridge";

/** What the Apple Watch row says, from what WatchConnectivity knows. */
export function watchRowSubtitle(input: {
  readonly paired: boolean;
  readonly installed: boolean;
  readonly watchName: string | null;
}): string {
  if (!input.paired) return "No Apple Watch is paired with this iPhone.";
  if (!input.installed) {
    return "Install SKYCOT on the Watch: open the Watch app on this iPhone, then Available Apps.";
  }
  if (input.watchName !== null) {
    return `${input.watchName} can say yes once, or no, while it's unlocked and on your wrist.`;
  }
  return "Your Watch shows requests and today's time. Set it up to say yes too.";
}

export function ThisDeviceScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const links = useLinks();
  const grownUp = useGrownUp();
  // The Watch's set-up sends one code to every linked Mac: known only when they all agree.
  const codeLength = useSharedCodeLength(grownUp.macs.map((mac) => mac.macId));
  const faceId = passkeySupport();
  const [locked, setLocked] = useState(false);
  const [locking, setLocking] = useState(false);
  const [unlinking, setUnlinking] = useState<Mac | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const watch = useWatch();
  const [settingUpWatch, setSettingUpWatch] = useState(false);
  const [watchProblem, setWatchProblem] = useState<string | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);

  const lockAll = async () => {
    setLocking(true);
    const results = await Promise.all(
      grownUp.macs.map((mac) => familyApi.lockEverything(mac.transport)),
    );
    setLocking(false);
    if (results.every((result) => result.ok)) {
      haptic("success");
      setLocked(true);
      watch.noteLocked();
    } else setProblem("One Mac didn't answer. Try again when it's awake.");
  };

  return (
    <Page>
      <Section title="Face ID" footer={faceId.possible ? undefined : (faceId.reason ?? undefined)}>
        <Row
          leading={
            <RowIcon name="faceid" color={faceId.possible ? theme.color.green : "#8E8E93"} />
          }
          title="Use Face ID to say yes"
          subtitle={
            faceId.possible
              ? "Set it up once with the parent code."
              : "For now, the parent code says yes."
          }
        />
      </Section>
      {watch.link.supported ? (
        <Section
          title="Apple Watch"
          footer={
            watchProblem ??
            "Your Watch asks your iPhone, and your iPhone asks the Mac: the Watch has no sign-in of its own. A yes from the Watch is logged as from your Watch, through this iPhone."
          }
        >
          <Row
            leading={
              <RowIcon
                name="applewatch"
                color={watch.watchName !== null ? theme.color.green : "#8E8E93"}
              />
            }
            title={watch.watchName !== null ? "Say yes from my Watch" : "Apple Watch"}
            subtitle={watchRowSubtitle({
              paired: watch.link.paired,
              installed: watch.link.installed,
              watchName: watch.watchName,
            })}
            trailing={
              watch.link.paired && watch.link.installed && watch.watchName === null ? (
                <Button
                  title="Set up"
                  kind="tinted"
                  size="small"
                  onPress={() => {
                    setWatchProblem(null);
                    setSettingUpWatch(true);
                  }}
                />
              ) : null
            }
          />
          {watch.watchName !== null ? (
            <Row
              title="Stop saying yes from the Watch"
              subtitle="It still shows requests and today's time, and can still say no."
              destructive
              onPress={async () => {
                if (watchBusy) return;
                setWatchBusy(true);
                setWatchProblem(await watch.forget());
                setWatchBusy(false);
              }}
            />
          ) : null}
        </Section>
      ) : null}
      <Section
        title="Lock"
        footer={
          problem ??
          "Ends every grown-up's yes on every device, such as Advanced mode left open on the Mac. Nothing else changes."
        }
      >
        <Row
          leading={<RowIcon name="lock.fill" color={theme.color.orange} />}
          title={locked ? "Everything is locked" : "Lock everything"}
          trailing={
            locked ? null : (
              <Button title="Lock" kind="tinted" size="small" busy={locking} onPress={lockAll} />
            )
          }
        />
      </Section>
      <Section title="This device">
        {grownUp.macs.map((mac) => (
          <Row
            key={mac.macId}
            leading={<RowIcon name="iphone" color={theme.color.accent} />}
            title={mac.me.deviceName}
            subtitle={`On ${mac.macName}: a grown-up's device. It reads and says yes or no, and can't change anything.`}
          />
        ))}
        <Row
          leading={<RowIcon name="desktopcomputer" color="#8E8E93" />}
          title="Linked Macs"
          chevron
          onPress={() => navigation.navigate("Macs")}
        />
        {grownUp.macs.map((mac) => (
          <Row
            key={`unlink:${mac.macId}`}
            title={grownUp.macs.length > 1 ? `Unlink from ${mac.macName}` : "Unlink this device"}
            subtitle="It stops working with SKYCOT straight away."
            destructive
            onPress={() => setUnlinking(mac)}
          />
        ))}
      </Section>
      <ParentCodeSheet
        visible={settingUpWatch}
        title="Say yes from your Watch?"
        description="Open SKYCOT on your Apple Watch first. Then enter the parent code: your Watch makes its own key and can say yes once while it's unlocked and on your wrist."
        actionLabel="Set up"
        length={codeLength}
        onClose={() => setSettingUpWatch(false)}
        onCode={async (code) => {
          const result = await watch.enrol(code);
          if (result === null) setSettingUpWatch(false);
          return result;
        }}
      />
      <Sheet
        visible={unlinking !== null}
        title="Unlink this device?"
        onClose={() => setUnlinking(null)}
      >
        <Txt>
          It stops working with SKYCOT straight away and forgets its Face ID. A grown-up can link it
          again from the family's Mac.
        </Txt>
        <Button
          title="Unlink"
          kind="destructive"
          busy={busy}
          onPress={async () => {
            if (unlinking === null) return;
            setBusy(true);
            await familyApi.unlinkSelf(unlinking.transport);
            await links.forget(unlinking.macId);
            setBusy(false);
            setUnlinking(null);
          }}
        />
        <Button title="Keep it" kind="grey" onPress={() => setUnlinking(null)} />
      </Sheet>
    </Page>
  );
}
