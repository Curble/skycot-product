/**
 * Scan the Mac's QR code, or type its twelve-letter code and address. Both end in the same
 * link (src/links/pairing.ts), and the Mac decides what this device becomes.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, TextInput, View } from "react-native";

import {
  LinkError,
  linkToMac,
  LINK_COPY,
  readLinkInput,
  type LinkInput,
  type LinkedMac,
} from "../../links/pairing";
import { useLinks } from "../../links/store";
import { newHomeRecord, RelayHome } from "@t3tools/skycot-relay/client/home";
import { waysToMac } from "../../transport/ways";
import { Banner, Button, haptic, Sheet, Symbol, Txt } from "../../ui/kit";
import { useTheme } from "../../ui/theme";

export type LinkOutcome = { readonly kind: "linked"; readonly mac: LinkedMac };

function useLinkAction(onLinked: (outcome: LinkOutcome) => void) {
  const links = useLinks();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (input: LinkInput) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const target = readLinkInput(input);
      // A link that carries SKYCOT Relay's part: this device makes its own tunnel key for the
      // Mac now, and links through the tunnel or, failing that, the Mac's own address.
      const relayRecord = target.relay === null ? null : newHomeRecord(target.relay);
      const relay =
        relayRecord === null ? null : new RelayHome({ record: relayRecord, save: () => undefined });
      const linked = await linkToMac(target, {
        ways: (bearerToken) => waysToMac({ httpBaseUrl: target.httpBaseUrl, bearerToken, relay }),

        deviceLabel: "SKYCOT app",
        deviceType: Platform.OS === "ios" && Platform.isPad ? "tablet" : "mobile",
      });
      // The tunnel's record after the handshake (its newest time and cookies) is the one kept.
      const finalRecord = relay?.currentRecord ?? null;
      relay?.close();
      if (!(await links.add({ ...linked, relayRecord: finalRecord }))) {
        setProblem(LINK_COPY["wrong-kind"]);
        haptic("warning");
        return;
      }
      haptic("success");
      onLinked({ kind: "linked", mac: linked });
    } catch (cause) {
      if (__DEV__) console.warn("[skycot] link:", cause instanceof Error ? cause.message : cause);
      haptic("warning");
      setProblem(cause instanceof LinkError ? cause.message : LINK_COPY.unreachable);
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, run, clear: () => setProblem(null) };
}

const fieldStyle = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: theme.color.card,
  borderRadius: theme.radius.control,
  paddingHorizontal: 16,
  paddingVertical: 14,
  color: theme.color.label,
  borderWidth: theme.look === "workshop" ? 1.5 : 0,
  borderColor: theme.color.outline,
});

export function TypeCodeSheet(props: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onLinked: (outcome: LinkOutcome) => void;
  /** From a `skycot://link` link: fills the sheet in (and, in development builds, links). */
  readonly prefill?: {
    readonly code: string;
    readonly address: string;
    readonly go: boolean;
    readonly scanned?: string | undefined;
  } | null;
}) {
  const theme = useTheme();
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const action = useLinkAction(props.onLinked);
  const prefill = props.prefill ?? null;
  useEffect(() => {
    if (prefill === null) return;
    if (prefill.scanned !== undefined) {
      if (prefill.go) void action.run({ kind: "scanned", text: prefill.scanned });
      return;
    }
    setCode(prefill.code);
    setAddress(prefill.address);
    if (prefill.go)
      void action.run({ kind: "typed", code: prefill.code, address: prefill.address });
    // Runs once per link handed in.
  }, [prefill]);
  const addressRef = useRef<ComponentRef<typeof TextInput>>(null);
  const tidy = code
    .replace(/[^0-9A-Za-z]/gu, "")
    .toUpperCase()
    .slice(0, 12);
  return (
    <Sheet
      visible={props.visible}
      title="Type the code"
      onClose={() => {
        setCode("");
        setAddress("");
        action.clear();
        props.onClose();
      }}
    >
      <Txt tone="label2">
        On the Mac: Settings › Family › Phones and iPads › Link…. The code and the address are under
        the QR code. Each code works once, for five minutes.
      </Txt>
      <View style={{ gap: 8 }}>
        <Txt variant="footnote" tone="label2" style={{ textTransform: "uppercase", marginLeft: 4 }}>
          Code
        </Txt>
        <TextInput
          value={code}
          maxLength={16}
          onChangeText={(text) => {
            action.clear();
            setCode(text.toUpperCase());
          }}
          placeholder="7KQ3 M9XD 2HPA"
          placeholderTextColor={theme.color.label3}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="next"
          onSubmitEditing={() => addressRef.current?.focus()}
          accessibilityLabel="The twelve-letter code"
          style={[
            fieldStyle(theme),
            { fontSize: 24, letterSpacing: 3, textAlign: "center", fontVariant: ["tabular-nums"] },
          ]}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Txt variant="footnote" tone="label2" style={{ textTransform: "uppercase", marginLeft: 4 }}>
          The Mac's address
        </Txt>
        <TextInput
          ref={addressRef}
          value={address}
          onChangeText={(text) => {
            action.clear();
            setAddress(text);
          }}
          placeholder="192.168.1.20:3773"
          placeholderTextColor={theme.color.label3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void action.run({ kind: "typed", code: tidy, address })}
          accessibilityLabel="The Mac's address"
          style={[fieldStyle(theme), { fontSize: 17 }]}
        />
      </View>
      {action.problem ? <Banner tone="warning" text={action.problem} /> : null}
      <Button
        title={action.busy ? "Linking…" : "Link"}
        busy={action.busy}
        disabled={tidy.length !== 12 || address.trim().length === 0}
        onPress={() => void action.run({ kind: "typed", code: tidy, address })}
      />
    </Sheet>
  );
}

export function ScanSheet(props: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onLinked: (outcome: LinkOutcome) => void;
  readonly onType: () => void;
}) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const action = useLinkAction(props.onLinked);
  const seen = useRef<string | null>(null);
  return (
    <Sheet visible={props.visible} title="Scan the code" onClose={props.onClose}>
      <Txt tone="label2">
        Point the camera at the QR code on the Mac: Settings › Family › Phones and iPads › Link….
      </Txt>
      <View
        style={{
          aspectRatio: 1,
          borderRadius: theme.radius.card,
          overflow: "hidden",
          backgroundColor: "#000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {permission?.granted ? (
          <CameraView
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              action.busy
                ? undefined
                : ({ data }) => {
                    if (seen.current === data) return;
                    seen.current = data;
                    void action.run({ kind: "scanned", text: data });
                  }
            }
          />
        ) : (
          <View style={{ alignItems: "center", gap: 12, padding: 24 }}>
            <Symbol name="qrcode.viewfinder" size={56} color="#FFFFFF" />
            <Txt center style={{ color: "#FFFFFF" }}>
              {permission?.canAskAgain === false
                ? "Camera access is off for SKYCOT. Turn it on in Settings, or type the code instead."
                : "SKYCOT needs the camera to read the code."}
            </Txt>
            {permission?.canAskAgain !== false ? (
              <Button title="Allow Camera" onPress={() => void requestPermission()} size="medium" />
            ) : null}
          </View>
        )}
      </View>
      {action.busy ? (
        <Txt center tone="label2">
          Linking…
        </Txt>
      ) : null}
      {action.problem ? (
        <Banner
          tone="warning"
          text={action.problem}
          action={{ title: "Scan again", onPress: () => ((seen.current = null), action.clear()) }}
        />
      ) : null}
      <Button title="Type the code instead" kind="plain" onPress={props.onType} />
    </Sheet>
  );
}
