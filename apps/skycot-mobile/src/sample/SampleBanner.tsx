/**
 * The sample family's banner: always on top, whichever screen is showing, so the sample can
 * never be mistaken for a linked Mac. "Leave the sample" ends it; the other button flips between
 * a grown-up's phone and Ava's own device (the two views a linked device can have).
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { useLinks } from "../links/store";
import { Button, Txt } from "../ui/kit";
import { ThemeProvider, useTheme } from "../ui/theme";
import { SAMPLE_BANNER_TEXT, SAMPLE_CODE_HINT, switchViewLabel } from "./sampleCopy";

function BannerBody() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const links = useLinks();
  if (links.sample === null) return null;
  const other = links.sample === "grown-up" ? "child" : "grown-up";
  return (
    <View
      accessibilityRole="summary"
      style={{
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
        gap: 8,
        backgroundColor: theme.color.markerSoft,
        borderBottomWidth: 2,
        borderBottomColor: theme.color.outline,
      }}
    >
      <Txt variant="subheadline" weight="700">
        {SAMPLE_BANNER_TEXT}
      </Txt>
      <Txt variant="footnote" tone="label2">
        {SAMPLE_CODE_HINT}
      </Txt>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          title="Leave the sample"
          size="small"
          onPress={links.leaveSample}
          accessibilityLabel="Leave the sample family"
        />
        <Button
          title={switchViewLabel(other)}
          size="small"
          kind="tinted"
          onPress={() => links.enterSample(other)}
        />
      </View>
    </View>
  );
}

/** The banner above the whole app; the app below it gets no top inset (the banner took it). */
export function SampleFrame(props: { readonly children: ReactNode }) {
  const links = useLinks();
  const insets = useSafeAreaInsets();
  if (links.sample === null) return <>{props.children}</>;
  return (
    <View style={{ flex: 1 }}>
      <ThemeProvider look="workshop">
        <BannerBody />
      </ThemeProvider>
      <View style={{ flex: 1 }}>
        <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
          {props.children}
        </SafeAreaInsetsContext.Provider>
      </View>
    </View>
  );
}
