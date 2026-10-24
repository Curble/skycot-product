// SKYCOT's Home Screen and Lock Screen widget, built the way T3 Code's widgets are
// (apps/mobile/src/widgets, MIT): the same content-free words as the Live Activity, from the
// app's last look at the Mac. It never reads the Mac itself.
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  resizable,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { FamilyActivity } from "../activity/state";

function FamilyStatus(
  props: Omit<FamilyActivity, "updatedAt"> & { readonly updatedAt?: string },
  environment: WidgetEnvironment,
) {
  "widget";
  const accessory = environment.widgetFamily === "accessoryRectangular";
  const monochrome =
    environment.widgetRenderingMode !== "fullColor" || environment.isLuminanceReduced === true;
  const light = environment.colorScheme !== "dark";
  const busy = props.phase === "needs-grown-up" || props.phase === "needs-you";
  const tint = monochrome
    ? ({ type: "hierarchical", style: "primary" } as const)
    : busy
      ? light
        ? "#C93400"
        : "#FFB340"
      : light
        ? "#0071E3"
        : "#7DC4FF";
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const symbol = busy
    ? "hand.raised.fill"
    : props.phase === "building"
      ? "hammer.fill"
      : "checkmark.circle.fill";
  return (
    <VStack
      alignment="leading"
      spacing={accessory ? 2 : 6}
      modifiers={[
        // The app's own link name (app.config.ts): "skycot" belongs to another app.
        widgetURL("skycot-family://"),
        ...(accessory ? [] : [containerBackground(light ? "#FFF6E6" : "#171A45", "widget")]),
      ]}
    >
      <HStack spacing={6} alignment="center">
        <HStack modifiers={[frame({ width: 26, height: 16 }), foregroundStyle(tint)]}>
          <Image assetName="SkycotMark" modifiers={[resizable()]} />
        </HStack>
        {accessory ? null : (
          <Text modifiers={[font({ weight: "semibold", size: 13 }), foregroundStyle(secondary)]}>
            SKYCOT
          </Text>
        )}
        <Spacer minLength={0} />
        <HStack modifiers={[frame({ width: 16, height: 16 }), foregroundStyle(tint)]}>
          <Image systemName={symbol} modifiers={[resizable()]} />
        </HStack>
      </HStack>
      {accessory ? null : <Spacer minLength={0} />}
      <Text modifiers={[font({ weight: "bold", size: accessory ? 14 : 17 }), lineLimit(2)]}>
        {props.headline}
      </Text>
      <Text
        modifiers={[font({ size: accessory ? 11 : 13 }), foregroundStyle(secondary), lineLimit(2)]}
      >
        {props.detail}
      </Text>
    </VStack>
  );
}

export default createWidget("FamilyStatus", FamilyStatus, {
  headline: "SKYCOT",
  detail: "Open SKYCOT to link this device.",
  phase: "quiet",
  count: 0,
  deepLink: "/",
});
