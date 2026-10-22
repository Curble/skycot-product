// Every sentence the mascot gets, in one place. The character is SKYCOT, like the product
// (MASCOT_NAME in src/brand.ts); "SKYCOT the cloud" only where it could be mistaken for the app.
import { MASCOT_FULL_NAME, MASCOT_NAME } from "../../brand";

export type MascotPose = "hello" | "yay" | "ask-a-grown-up" | "thinking" | "oops" | "night-night";

/** What each pose is doing, for people who hear the screen rather than see it. */
export const MASCOT_POSE_DESCRIPTIONS: Record<MascotPose, string> = {
  hello: "waving",
  yay: "cheering",
  "ask-a-grown-up": "asking for a grown-up",
  thinking: "thinking",
  oops: "saying oops",
  "night-night": "asleep",
};

/** The spoken name of a mascot picture: "SKYCOT the cloud, waving". */
export function mascotAccessibleName(pose: MascotPose, description?: string): string {
  const doing = description?.trim() || MASCOT_POSE_DESCRIPTIONS[pose];
  return `${MASCOT_FULL_NAME}, ${doing}`;
}

export const mascotCopy = {
  /** Above the Home greeting, beside the waving mascot. */
  homeHello: `${MASCOT_NAME} says hello`,
  /** First onboarding step, where the waving mascot introduces itself. */
  introduction: `Hi, I'm ${MASCOT_NAME}.`,
  /** Settings › About, under the version. */
  aboutLine: `The cloud is ${MASCOT_NAME} too.`,
  /** Settings › Appearance, under the day / dusk choice. */
  appearanceFooter: `By day ${MASCOT_NAME} sits in a blue morning sky; from dusk to dawn where you are, it switches to its twilight look with a star. Light or dark mode is separate.`,
} as const;
