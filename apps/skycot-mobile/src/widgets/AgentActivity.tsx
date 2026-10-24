// Forked from T3 Code's apps/mobile/src/widgets/AgentActivity.tsx (MIT) and rebranded: the
// same Live Activity layouts (Lock Screen banner, Dynamic Island compact, minimal and
// expanded), SKYCOT's cloud mark instead of T3's, and SKYCOT's content-free words ("Sam is
// building…", "Ava needs a grown-up") instead of a list of agents and threads. On watchOS the
// same activity appears in the Smart Stack. Fed from local state for now (src/activity);
// pushes wait for SKYCOT Relay.
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  resizable,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityComponent,
  type LiveActivityLayout,
} from "expo-widgets";

import type { FamilyActivity } from "../activity/state";

type LiveActivityEnvironment = Parameters<LiveActivityComponent<FamilyActivity>>[1];

// Serialized into the widget extension's own bundle: it must stay self-contained (only the
// imported view and modifier factories, no module-scope helpers).
export function AgentActivity(
  props: FamilyActivity,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";

  type Foreground = Parameters<typeof foregroundStyle>[0];
  const primary = { type: "hierarchical", style: "primary" } as const;
  const secondary = { type: "hierarchical", style: "secondary" } as const;
  const monochrome =
    environment.widgetRenderingMode === "accented" || environment.widgetRenderingMode === "vibrant";
  const light = environment.colorScheme === "light";
  const tint: Foreground = environment.isLuminanceReduced
    ? secondary
    : monochrome
      ? primary
      : props.phase === "needs-grown-up" || props.phase === "needs-you"
        ? light
          ? "#C93400"
          : "#FFB340"
        : light
          ? "#0071E3"
          : "#7DC4FF";
  const stale = environment.isStale === true;
  const headline = stale ? "SKYCOT" : props.headline;
  const detail = stale ? "Open SKYCOT to see what's new." : props.detail;
  const link = props.deepLink.startsWith("/") ? `skycot-family://${props.deepLink.slice(1)}` : null;
  const links = link ? [widgetURL(link)] : [];

  type SFName = NonNullable<ComponentProps<typeof Image>["systemName"]>;
  const symbol: SFName =
    props.phase === "needs-grown-up" || props.phase === "needs-you"
      ? "hand.raised.fill"
      : props.phase === "building"
        ? "hammer.fill"
        : "checkmark.circle.fill";

  const mark = (height: number, color: Foreground) => (
    <HStack modifiers={[frame({ width: height * 1.6, height }), foregroundStyle(color)]}>
      <Image assetName="SkycotMark" modifiers={[resizable()]} />
    </HStack>
  );
  const glyph = (size: number, color: Foreground) => (
    <HStack modifiers={[frame({ width: size, height: size }), foregroundStyle(color)]}>
      <Image systemName={symbol} modifiers={[resizable()]} />
    </HStack>
  );

  return {
    banner: (
      <HStack
        spacing={12}
        alignment="center"
        modifiers={[
          padding({ all: 16 }),
          activityBackgroundTint(environment.isLiquidGlassAvailable ? "clear" : null),
          ...links,
        ]}
      >
        {mark(26, tint)}
        <VStack alignment="leading" spacing={2}>
          <Text
            modifiers={[
              font({ weight: "semibold", size: 16 }),
              foregroundStyle(primary),
              lineLimit(1),
            ]}
          >
            {headline}
          </Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>
            {detail}
          </Text>
        </VStack>
        <Spacer minLength={4} />
        {glyph(22, tint)}
      </HStack>
    ),
    // The small family: the Apple Watch Smart Stack (watchOS 11 and later) and CarPlay. Room
    // for two short lines, so the name and "needs a grown-up" are never cut off.
    bannerSmall: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 10 }), ...links]}>
        <HStack spacing={6} alignment="center">
          {mark(14, tint)}
          <Spacer minLength={2} />
          {glyph(14, tint)}
        </HStack>
        <Text
          modifiers={[
            font({ weight: "semibold", size: 15 }),
            foregroundStyle(primary),
            lineLimit(2),
          ]}
        >
          {headline}
        </Text>
      </VStack>
    ),
    compactLeading: mark(14, tint),
    compactTrailing: glyph(14, tint),
    minimal: glyph(13, tint),
    expandedLeading: (
      <HStack modifiers={[padding({ leading: 6, vertical: 4 })]}>{mark(18, tint)}</HStack>
    ),
    expandedCenter: null,
    expandedTrailing: (
      <HStack modifiers={[padding({ trailing: 6, vertical: 4 })]}>{glyph(18, tint)}</HStack>
    ),
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[padding({ horizontal: 10, vertical: 2 }), ...links]}
      >
        <Text
          modifiers={[
            font({ weight: "semibold", size: 15 }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {headline}
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(1)]}>
          {detail}
        </Text>
      </VStack>
    ),
  };
}

export default createLiveActivity<FamilyActivity>("AgentActivity", AgentActivity);
