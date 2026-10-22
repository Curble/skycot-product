// The SKYCOT mascot at one of its six moments, in the drawing that matches the sky (day or
// dusk). It is artwork, not chrome: themes never restyle it. The files are copies of
// nondev/brand/assets/poses (node nondev/scripts/sync-brand-assets.ts) and stay unnamed until the
// character has a name (MASCOT_NAME in src/brand.ts).
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
import { MASCOT_NAME } from "../../brand";
import type { SkyPhase } from "../../plain/daylight";
import { useDaylightPhase } from "./useDaylightPhase";

export type MascotPose = "hello" | "yay" | "ask-a-grown-up" | "thinking" | "oops" | "night-night";

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
  className,
}: {
  readonly pose: MascotPose;
  /** Rendered width and height in CSS pixels. */
  readonly size?: number;
  /** Spoken description. Omit when the text beside it already says what the moment is. */
  readonly label?: string;
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
      {...(label ? { role: "img", "aria-label": spokenLabel(label) } : { "aria-hidden": true })}
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

function spokenLabel(label: string): string {
  return MASCOT_NAME ? `${MASCOT_NAME}: ${label}` : label;
}
