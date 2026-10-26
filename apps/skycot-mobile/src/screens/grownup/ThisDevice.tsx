/**
 * This device, on a grown-up's phone: Face ID (this phone's own Secure Enclave key, set up once
 * with the parent code; src/faceid), Apple Watch (say yes from the wrist, Phase 4), Lock everything
 * (ends every grown-up's yes on every device), the linked Macs, About, and Unlink this device.
 * Phase 1's copy throughout.
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";

import type { StackRoutes } from "../../app/routes";
import { useGrownUp } from "../../app/grownup/GrownUpContext";
import { useSharedCodeLength } from "../../data/MacData";
import { SkycotDeviceKey } from "../../../modules/skycot-device-key";
import { useFaceId } from "../../faceid/FaceIdProvider";
import { familyApi } from "../../family/api";
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

/** The Face ID row's title: what it does once it is on. */
export function faceIdRowTitle(label: string, everywhere: boolean): string {
  return everywhere ? `${label} says yes` : `Use ${label} to say yes`;
}

/** The Face ID row's subtitle, from what this iPhone and the linked Macs know. */
export function faceIdRowSubtitle(input: {
  readonly label: string;
  readonly available: boolean;
  readonly everywhere: boolean;
}): string {
  if (input.everywhere) return "Allow once asks for it each time, for that one request.";
  if (!input.available) {
    return `Turn on ${input.label} for this iPhone in Settings to use it here. For now, the parent code says yes.`;
  }
  return "Set it up once with the parent code.";
}

export function ThisDeviceScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const links = useLinks();
  const grownUp = useGrownUp();
  // The Watch's set-up sends one code to every linked Mac: known only when they all agree.
  const codeLength = useSharedCodeLength(grownUp.macs.map((mac) => mac.macId));
  const faceId = useFaceId();
  const [settingUpFaceId, setSettingUpFaceId] = useState(false);
  const [faceIdProblem, setFaceIdProblem] = useState<string | null>(null);
  const [faceIdBusy, setFaceIdBusy] = useState(false);
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
      <Section
        title={faceId.label}
        footer={
          faceIdProblem ??
          `Allow once asks you to confirm with ${faceId.label}. The parent code always works too, and saying no never needs either.`
        }
      >
        <Row
          leading={
            <RowIcon
              name={faceId.label === "Touch ID" ? "touchid" : "faceid"}
              color={faceId.everywhere ? theme.color.green : "#8E8E93"}
            />
          }
          title={faceIdRowTitle(faceId.label, faceId.everywhere)}
          subtitle={faceIdRowSubtitle({
            label: faceId.label,
            available: faceId.native?.available ?? false,
            everywhere: faceId.everywhere,
          })}
          trailing={
            faceId.native?.available && !faceId.everywhere ? (
              <Button
                title="Set up"
                kind="tinted"
                size="small"
                onPress={() => {
                  setFaceIdProblem(null);
                  setSettingUpFaceId(true);
                }}
              />
            ) : null
          }
        />
        {faceId.native?.hasKey ? (
          <Row
            title={`Stop using ${faceId.label}`}
            subtitle="Allow once asks for the parent code again."
            destructive
            onPress={async () => {
              if (faceIdBusy) return;
              setFaceIdBusy(true);
              setFaceIdProblem(await faceId.stop());
              setFaceIdBusy(false);
            }}
          />
        ) : null}
      </Section>
      {watch.link.supported ? (
        <Section
          title="Apple Watch"
          footer={
            watchProblem ??
            "Your Watch asks this iPhone, which checks with the Mac. A yes from your Watch is recorded as yours."
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
            subtitle={`Linked to ${mac.macName}. You can answer requests here.`}
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
        visible={settingUpFaceId}
        title={`Use ${faceId.label} to say yes?`}
        description={`Enter the parent code once. Then Allow once asks for your ${faceId.label === "Touch ID" ? "fingerprint" : "face"} instead, every time.`}
        actionLabel="Set up"
        length={codeLength}
        onClose={() => setSettingUpFaceId(false)}
        onCode={async (code) => {
          const result = await faceId.setUp(code);
          if (result === null) {
            setSettingUpFaceId(false);
            haptic("success");
          }
          return result;
        }}
      />
      <ParentCodeSheet
        visible={settingUpWatch}
        title="Say yes from your Watch?"
        description="Open SKYCOT on your Apple Watch first. Then enter the parent code once. Your Watch can confirm a request while it is unlocked and on your wrist."
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
            // The last Mac gone: this phone's Face ID key goes too (the Mac forgot its half).
            if (grownUp.macs.length <= 1) SkycotDeviceKey?.remove();
            setBusy(false);
            setUnlinking(null);
          }}
        />
        <Button title="Keep it" kind="grey" onPress={() => setUnlinking(null)} />
      </Sheet>
    </Page>
  );
}
