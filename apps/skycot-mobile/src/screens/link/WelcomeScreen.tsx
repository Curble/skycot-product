/**
 * First run: "Link to your family's Mac". Nothing else works until a grown-up has made a link
 * at the Mac; there are no accounts to sign in to, ever.
 */
import { useEffect, useState } from "react";

import { useDeepLink } from "../../links/deepLinks";
import { useLinks } from "../../links/store";
import { CHILD_MODE_ENABLED } from "../../app/childModeFlag";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AboutSheet } from "../shared/About";
import { Button, Mascot, Txt } from "../../ui/kit";
import { useTheme } from "../../ui/theme";
import { ScanSheet, TypeCodeSheet, type LinkOutcome } from "./LinkSheets";

export function WelcomeScreen(props: { readonly onLinked?: (outcome: LinkOutcome) => void }) {
  const theme = useTheme();
  const links = useLinks();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<"scan" | "type" | "about" | null>(null);
  const deep = useDeepLink("link");
  const [prefill, setPrefill] = useState<typeof deep.link>(null);
  useEffect(() => {
    if (deep.link === null) return;
    setPrefill(deep.link);
    setSheet("type");
    deep.consume();
  }, [deep]);
  const linked = (outcome: LinkOutcome) => {
    setSheet(null);
    props.onLinked?.(outcome);
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 28,
        }}
      >
        <View style={{ width: "100%", maxWidth: 460, alignSelf: "center", gap: 18 }}>
          <View style={{ alignItems: "center" }}>
            <Mascot pose="hello" size={150} />
          </View>
          <Txt variant="largeTitle" center>
            Link to your family's Mac
          </Txt>
          <Txt tone="label2" center>
            SKYCOT runs on your family's Mac. This iPhone or iPad is a window into it, so a grown-up
            links it once, at the Mac.
          </Txt>
          <View
            style={{
              gap: 10,
              backgroundColor: theme.color.card,
              borderRadius: theme.radius.card,
              padding: 16,
            }}
          >
            <Step n={1} text="On the Mac, open SKYCOT › Settings › Family › Phones and iPads." />
            <Step
              n={2}
              text={
                CHILD_MODE_ENABLED
                  ? "Choose Link…, then who this device is for: a child, or a grown-up."
                  : "Choose Link…, then pick yourself, as a grown-up."
              }
            />
            <Step n={3} text="Scan the QR code it shows, or type its twelve-letter code." />
          </View>
          <Button title="Scan the code" icon="qrcode.viewfinder" onPress={() => setSheet("scan")} />
          <Button title="Type the code instead" kind="tinted" onPress={() => setSheet("type")} />
          <Button
            title="Look around first"
            kind="grey"
            icon="eye"
            onPress={() => links.enterSample("grown-up")}
            accessibilityLabel="Look around first, with a sample family"
          />
          <Txt variant="footnote" tone="label3" center>
            A sample family shows how SKYCOT works. Nothing in it is real.
          </Txt>
          <Txt variant="footnote" tone="label3" center>
            No accounts and no sign-up. Your family's work stays on your Mac.
          </Txt>
          <Pressable accessibilityRole="button" onPress={() => setSheet("about")} hitSlop={8}>
            <Txt variant="footnote" tone="accent" center>
              About SKYCOT
            </Txt>
          </Pressable>
        </View>
      </ScrollView>
      <ScanSheet
        visible={sheet === "scan"}
        onClose={() => setSheet(null)}
        onLinked={linked}
        onType={() => setSheet("type")}
      />
      <TypeCodeSheet
        prefill={prefill}
        visible={sheet === "type"}
        onClose={() => setSheet(null)}
        onLinked={linked}
      />
      <AboutSheet visible={sheet === "about"} onClose={() => setSheet(null)} />
    </View>
  );
}

function Step(props: { readonly n: number; readonly text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: theme.color.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Txt variant="footnote" weight="700" tone="onAccent">
          {String(props.n)}
        </Txt>
      </View>
      <Txt variant="subheadline" style={{ flex: 1 }}>
        {props.text}
      </Txt>
    </View>
  );
}
