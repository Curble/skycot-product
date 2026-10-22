// The SKYCOT mascot at one of its six moments, in the drawing that matches the sky (day or
// dusk). It is artwork, not chrome: themes never restyle it. The files are copies of
// nondev/brand/assets/poses (node nondev/scripts/sync-brand-assets.ts); the file names stay
// "mascot-…" by design. The character is SKYCOT; what it says lives in ./mascotCopy.
import { useState, type CSSProperties } from "react";

import askDay from "../../assets/brand/mascot-ask-a-grown-up-day.svg";
import askDusk from "../../assets/brand/mascot-ask-a-grown-up-dusk.svg";
import helloDay from "../../assets/brand/mascot-hello-day.svg";
import helloDusk from "../../assets/brand/mascot-hello-dusk.svg";
import nightDay from "../../assets/brand/mascot-night-night-day.svg";
import nightDusk from "../../assets/brand/mascot-night-night-dusk.svg";
import oopsDay from "../../assets/brand/mascot-oops-day.svg";
import oopsDusk from "../../assets/brand/mascot-oops-dusk.svg";
import thinkingDay from "../../assets/brand/mascot-thinking-day.svg";
import thinkingDusk from "../../assets/brand/mascot-thinking-dusk.svg";
import yayDay from "../../assets/brand/mascot-yay-day.svg";
import yayDusk from "../../assets/brand/mascot-yay-dusk.svg";
import type { SkyPhase } from "../../plain/daylight";
import { mascotAccessibleName, type MascotPose } from "./mascotCopy";
import { useDaylightPhase } from "./useDaylightPhase";

export type { MascotPose };

const POSES: Record<MascotPose, Record<SkyPhase, string>> = {
  hello: { day: helloDay, dusk: helloDusk },
  yay: { day: yayDay, dusk: yayDusk },
  "ask-a-grown-up": { day: askDay, dusk: askDusk },
  thinking: { day: thinkingDay, dusk: thinkingDusk },
  oops: { day: oopsDay, dusk: oopsDusk },
  "night-night": { day: nightDay, dusk: nightDusk },
};

/** Below 32 px the sticker drawing turns into a smudge (brand guide, minimum sizes). */
const MIN_SIZE = 32;

export function Mascot({
  pose,
  size = 64,
  label,
  decorative = false,
  className,
}: {
  readonly pose: MascotPose;
  /** Rendered width and height in CSS pixels. */
  readonly size?: number;
  /** What the cloud is doing, spoken after its name ("cheering you on"). Defaults to the pose. */
  readonly label?: string;
  /** Hide it from screen readers when the text beside it already names SKYCOT or the moment. */
  readonly decorative?: boolean;
  readonly className?: string;
}) {
  const phase = useDaylightPhase();
  // Cross-fade only when the sky changes while this mascot is on screen; a mascot that mounts
  // already in the new drawing just appears. CSS drops the fade under Reduce motion.
  const [mountedPhase] = useState(phase);
  const px = Math.max(MIN_SIZE, size);
  return (
    <span
      className={["fm-mascot", `fm-mascot--${phase}`, className].filter(Boolean).join(" ")}
      style={{ width: px, height: px, "--fm-mascot-size": `${px}px` } as CSSProperties}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": mascotAccessibleName(pose, label) })}
    >
      <img
        key={phase}
        className={`fm-mascot__img${phase === mountedPhase ? "" : " fm-mascot__img--fade"}`}
        src={POSES[pose][phase]}
        alt=""
        width={px}
        height={px}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}
