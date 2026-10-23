/**
 * SKYCOT's mascot poses, day and dusk, from nondev/brand/assets (the same artwork as the Mac
 * and skycot.com). Day or dusk follows the sky where the device is (skycot-brand/daylight).
 */
import { phaseAt, type SkyPhase } from "@t3tools/skycot-brand/daylight";
import type { ImageSourcePropType } from "react-native";

import type { MascotPose } from "../../../nondev/src/features/brand/mascotCopy";

const DAY: Readonly<Record<MascotPose, ImageSourcePropType>> = {
  hello: require("../../../../nondev/brand/assets/poses/day/mascot-hello-day-512.png"),
  yay: require("../../../../nondev/brand/assets/poses/day/mascot-yay-day-512.png"),
  "ask-a-grown-up": require("../../../../nondev/brand/assets/poses/day/mascot-ask-a-grown-up-day-512.png"),
  thinking: require("../../../../nondev/brand/assets/poses/day/mascot-thinking-day-512.png"),
  oops: require("../../../../nondev/brand/assets/poses/day/mascot-oops-day-512.png"),
  "night-night": require("../../../../nondev/brand/assets/poses/day/mascot-night-night-day-512.png"),
};

const DUSK: Readonly<Record<MascotPose, ImageSourcePropType>> = {
  hello: require("../../../../nondev/brand/assets/poses/dusk/mascot-hello-dusk-512.png"),
  yay: require("../../../../nondev/brand/assets/poses/dusk/mascot-yay-dusk-512.png"),
  "ask-a-grown-up": require("../../../../nondev/brand/assets/poses/dusk/mascot-ask-a-grown-up-dusk-512.png"),
  thinking: require("../../../../nondev/brand/assets/poses/dusk/mascot-thinking-dusk-512.png"),
  oops: require("../../../../nondev/brand/assets/poses/dusk/mascot-oops-dusk-512.png"),
  "night-night": require("../../../../nondev/brand/assets/poses/dusk/mascot-night-night-dusk-512.png"),
};

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function skyPhaseNow(now: Date = new Date()): SkyPhase {
  return phaseAt(now, deviceTimeZone()).phase;
}

export function mascotSource(pose: MascotPose, phase: SkyPhase): ImageSourcePropType {
  return phase === "dusk" ? DUSK[pose] : DAY[pose];
}

export const PRODUCT_NAME = "SKYCOT";
/** The builder in the Workshop crew (the plain client's crew-builder). */
export const BUILDER_NAME = "Sam";

export const AVATAR_COLORS: Readonly<
  Record<string, { readonly light: string; readonly dark: string }>
> = {
  sky: { light: "#2f7de1", dark: "#3f8ef0" },
  sun: { light: "#d98a00", dark: "#e09a1a" },
  leaf: { light: "#2f9e57", dark: "#36ad62" },
  berry: { light: "#c2366b", dark: "#d84a80" },
  grape: { light: "#7a4fd0", dark: "#8e66e0" },
  coral: { light: "#e0603f", dark: "#ec7252" },
};

export type { MascotPose, SkyPhase };
