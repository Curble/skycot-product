/**
 * This device, on a grown-up's phone: Face ID (waits for SKYCOT Relay's secure address; the
 * parent code works meanwhile), Lock everything (ends every grown-up's yes on every device),
 * the linked Macs, About, and Unlink this device. Phase 1's copy throughout.
 */
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";

import type { StackRoutes } from "../../app/routes";
import { useGrownUp } from "../../app/grownup/GrownUpContext";
import { familyApi } from "../../family/api";
import { passkeySupport } from "../../family/passkey";
import { useLinks, type Mac } from "../../links/store";
import { Button, Page, Row, RowIcon, Section, Sheet, Txt, haptic } from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export function ThisDeviceScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<StackRoutes>>();
  const links = useLinks();
  const grownUp = useGrownUp();
  const faceId = passkeySupport();
  const [locked, setLocked] = useState(false);
  const [locking, setLocking] = useState(false);
  const [unlinking, setUnlinking] = useState<Mac | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const lockAll = async () => {
    setLocking(true);
    const results = await Promise.all(
      grownUp.macs.map((mac) => familyApi.lockEverything(mac.transport)),
    );
    setLocking(false);
    if (results.every((result) => result.ok)) {
      haptic("success");
      setLocked(true);
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
