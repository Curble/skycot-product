// One sticker per badge, drawn from the shared parts (SKYCOT, Sam, Mo, and simple objects) on a
// die-cut backing. Earned stickers are full colour; a sticker still to find is the same
// drawing as a soft silhouette (CSS, `.fm-sticker--silhouette`), so the shape is a clue and
// nothing new has to be drawn.
import type { BadgeId } from "@t3tools/skycot-rules/badges";
import type { ReactNode } from "react";

import {
  BLUE,
  CHEEK,
  CLOUD,
  CREAM,
  FINE,
  GRAPE,
  Heart,
  INK,
  LEAF,
  LINE,
  Lettering,
  Mo,
  Sam,
  SKY,
  SKY_SOFT,
  Skycot,
  Sparks,
  STAR,
  Star,
  StickerBase,
  TOMATO,
  Twinkle,
} from "./parts";

const ink = {
  stroke: INK,
  strokeWidth: LINE,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;
const fine = {
  stroke: INK,
  strokeWidth: FINE,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

function FirstCreation() {
  return (
    <>
      <StickerBase shape="scallop" fill={STAR} />
      <Sparks
        marks={[
          [22, 30, 28, 34, TOMATO],
          [97, 28, 92, 33, LEAF],
          [60, 19, 60, 25, BLUE],
        ]}
      />
      <Skycot x={60} y={56} w={62} face="yay" />
      {/* the "1st" ribbon */}
      <path d="M30 80H90L86 88L90 96H30L34 88Z" fill={TOMATO} {...ink} />
      <Lettering x={60} y={88.5} size={13} fill={CLOUD}>
        1st
      </Lettering>
    </>
  );
}

function Gamepad({ x, y, w, tilt = 0 }: { x: number; y: number; w: number; tilt?: number }) {
  const s = w / 60;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s}) translate(-30 -16)`}>
      <path
        d="M12 4H48C55 4 59 10 60 18L61 25C62 31 55 34 50 29L44 23H16L10 29C5 34-2 31-1 25L0 18C1 10 5 4 12 4Z"
        fill={GRAPE}
        stroke={INK}
        strokeWidth={LINE / s}
        strokeLinejoin="round"
      />
      <path d="M14 9V19M9 14H19" stroke={CLOUD} strokeWidth={4.2 / s} strokeLinecap="round" />
      <circle cx="43" cy="11" r="3.2" fill={STAR} stroke={INK} strokeWidth={FINE / s} />
      <circle cx="50" cy="17" r="3.2" fill={TOMATO} stroke={INK} strokeWidth={FINE / s} />
    </g>
  );
}

function FirstGame() {
  return (
    <>
      <StickerBase shape="rounded" fill={SKY_SOFT} />
      <Sam x={60} y={46} size={50} />
      <Gamepad x={60} y={82} w={58} tilt={-6} />
      <Sparks
        marks={[
          [22, 70, 27, 74, TOMATO],
          [99, 66, 93, 70, STAR],
        ]}
      />
    </>
  );
}

function Paw({ x, y, size }: { x: number; y: number; size: number }) {
  const s = size / 60;
  const w = LINE / s;
  return (
    <g transform={`translate(${x} ${y}) scale(${s}) translate(-30 -30)`}>
      <path
        d="M30 30C40 30 50 40 50 49C50 56 44 58 38 56C34 55 32 54 30 54C28 54 26 55 22 56C16 58 10 56 10 49C10 40 20 30 30 30Z"
        fill={CLOUD}
        stroke={INK}
        strokeWidth={w}
      />
      <ellipse
        cx="12"
        cy="24"
        rx="6"
        ry="8"
        fill={CLOUD}
        stroke={INK}
        strokeWidth={w}
        transform="rotate(-20 12 24)"
      />
      <ellipse
        cx="23"
        cy="12"
        rx="6.4"
        ry="8.6"
        fill={CLOUD}
        stroke={INK}
        strokeWidth={w}
        transform="rotate(-6 23 12)"
      />
      <ellipse
        cx="37"
        cy="12"
        rx="6.4"
        ry="8.6"
        fill={CLOUD}
        stroke={INK}
        strokeWidth={w}
        transform="rotate(6 37 12)"
      />
      <ellipse
        cx="48"
        cy="24"
        rx="6"
        ry="8"
        fill={CLOUD}
        stroke={INK}
        strokeWidth={w}
        transform="rotate(20 48 24)"
      />
      <ellipse cx="30" cy="45" rx="9" ry="6" fill={CHEEK} />
    </g>
  );
}

function AnimalFriend() {
  return (
    <>
      <StickerBase shape="circle" fill="#D9F5E3" />
      <Paw x={56} y={60} size={58} />
      <Heart x={88} y={34} size={20} />
      <Sparks
        marks={[
          [24, 36, 29, 40, STAR],
          [92, 84, 87, 80, LEAF],
        ]}
      />
    </>
  );
}

function DrewIt() {
  return (
    <>
      <StickerBase shape="rounded" fill={CREAM} />
      {/* a sheet of paper with a child's drawing on it */}
      <g transform="rotate(-6 56 58)">
        <rect x="24" y="26" width="62" height="58" rx="4" fill="#fff" {...ink} />
        <circle cx="70" cy="42" r="8" fill={STAR} {...fine} />
        <path d="M70 29V31M81 42H83M57 42H59M78 34L79.5 32.5M78 50L79.5 51.5" {...fine} />
        <path d="M32 74L44 58L56 74Z" fill={TOMATO} {...fine} />
        <path d="M34 74H82" {...fine} />
        <path
          d="M60 74C62 66 70 64 74 70"
          fill="none"
          stroke={LEAF}
          strokeWidth={FINE}
          strokeLinecap="round"
        />
      </g>
      {/* a crayon */}
      <g transform="rotate(38 88 82)">
        <rect x="80" y="62" width="14" height="36" rx="3" fill={BLUE} {...ink} />
        <path d="M80 70H94M80 90H94" stroke={CLOUD} strokeWidth={FINE} />
        <path d="M80 98L87 110L94 98Z" fill={BLUE} {...ink} />
      </g>
    </>
  );
}

function BigQuestion() {
  return (
    <>
      <StickerBase shape="circle" fill="#FFF1A8" />
      <Mo x={50} y={72} size={50} tilt={-4} />
      {/* thought bubble with a question mark */}
      <circle cx="74" cy="44" r="3" fill="#fff" {...fine} />
      <path
        d="M80 20C92 20 100 26 100 34C100 42 92 46 84 46C82 46 79 46 77 45C73 44 68 40 68 33C68 25 74 20 80 20Z"
        fill="#fff"
        {...ink}
      />
      <Lettering x={84} y={33.5} size={20}>
        ?
      </Lettering>
      <Lettering x={30} y={34} size={14} fill={BLUE}>
        ?
      </Lettering>
    </>
  );
}

function Undo() {
  return (
    <>
      <StickerBase shape="circle" fill={SKY_SOFT} />
      {/* the turn-back arrow around SKYCOT */}
      <path
        d="M34 40C42 26 62 22 76 30C90 38 96 56 88 72"
        fill="none"
        stroke={INK}
        strokeWidth="11"
        strokeLinecap="round"
      />
      <path
        d="M34 40C42 26 62 22 76 30C90 38 96 56 88 72"
        fill="none"
        stroke={BLUE}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path d="M22 34L34 46L40 31Z" fill={BLUE} {...ink} />
      <Skycot x={56} y={70} w={56} face="smile" />
    </>
  );
}

function MoCheck() {
  return (
    <>
      <StickerBase shape="rounded" fill="#D9F5E3" />
      <Mo x={48} y={62} size={56} />
      {/* the big tick, on its own little card */}
      <g transform="rotate(10 86 38)">
        <rect x="72" y="22" width="30" height="30" rx="8" fill="#fff" {...ink} />
        <path
          d="M79 37L85 43L96 30"
          fill="none"
          stroke={LEAF}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <Sparks marks={[[92, 86, 98, 90, STAR]]} />
    </>
  );
}

function Voice() {
  return (
    <>
      <StickerBase shape="circle" fill="#FFE1D9" />
      <Skycot x={50} y={52} w={56} face="wow" />
      {/* sound coming out */}
      <path
        d="M82 38Q88 44 82 50M89 32Q99 44 89 56"
        fill="none"
        stroke={TOMATO}
        strokeWidth={LINE}
        strokeLinecap="round"
      />
      {/* the microphone */}
      <g transform="rotate(-12 64 88)">
        <rect x="56" y="70" width="16" height="22" rx="8" fill="#5B5B66" {...ink} />
        <path
          d="M58 77H70M58 83H70"
          stroke={CLOUD}
          strokeWidth={FINE * 0.8}
          strokeLinecap="round"
        />
        <path d="M64 92V100M57 100H71" fill="none" {...ink} />
      </g>
    </>
  );
}

function Together() {
  return (
    <>
      <StickerBase shape="cloud" fill={SKY} />
      <Skycot x={44} y={66} w={46} face="smile" tilt={-6} />
      <Skycot x={80} y={72} w={36} face="yay" tilt={8} />
      <Heart x={64} y={40} size={18} />
    </>
  );
}

function KindWords() {
  return (
    <>
      <StickerBase shape="heart" fill={CHEEK} />
      <path
        d="M30 34H90Q96 34 96 40V62Q96 68 90 68H56L44 78L46 68H30Q24 68 24 62V40Q24 34 30 34Z"
        fill="#fff"
        {...ink}
      />
      <Lettering x={60} y={51} size={15}>
        thanks!
      </Lettering>
      <Heart x={84} y={84} size={12} fill={TOMATO} />
    </>
  );
}

function GoodNight() {
  return (
    <>
      <StickerBase shape="circle" fill="#3C3486" gradient={["#232766", "#6A4A9E"]} />
      <path d="M86 26A15 15 0 1 0 98 48A12 12 0 1 1 86 26Z" fill={STAR} {...fine} />
      <Twinkle x={30} y={34} r={6} />
      <Twinkle x={46} y={24} r={3.5} fill="#B9A8E8" />
      <Twinkle x={98} y={66} r={3.5} fill="#B9A8E8" />
      <Skycot x={58} y={72} w={64} face="sleep" />
      <Lettering x={84} y={52} size={11} fill="#B9A8E8">
        z
      </Lettering>
      <Lettering x={92} y={42} size={8} fill="#B9A8E8">
        z
      </Lettering>
    </>
  );
}

function Five() {
  return (
    <>
      <StickerBase shape="star" fill={STAR} />
      <Lettering x={60} y={68} size={46} fill={TOMATO} outline={INK}>
        5
      </Lettering>
      <Twinkle x={84} y={40} r={5} fill="#fff" />
    </>
  );
}

function Ten() {
  return (
    <>
      {/* ribbon tails behind the rosette */}
      <path d="M42 84L34 112L46 106L52 116L58 88Z" fill={BLUE} {...ink} />
      <path d="M78 84L86 112L74 106L68 116L62 88Z" fill={BLUE} {...ink} />
      <StickerBase shape="scallop" fill={TOMATO} />
      <circle cx="60" cy="58" r="30" fill={CREAM} {...ink} />
      <Lettering x={60} y={60} size={34}>
        10
      </Lettering>
      <Sam x={26} y={26} size={24} tilt={-12} />
      <Mo x={95} y={27} size={24} tilt={12} />
    </>
  );
}

function Explorer() {
  return (
    <>
      <StickerBase shape="circle" fill={SKY_SOFT} />
      {/* three starter cards, fanned out */}
      <rect
        x="22"
        y="30"
        width="34"
        height="44"
        rx="6"
        fill={TOMATO}
        {...ink}
        transform="rotate(-16 39 52)"
      />
      <rect
        x="64"
        y="30"
        width="34"
        height="44"
        rx="6"
        fill={LEAF}
        {...ink}
        transform="rotate(16 81 52)"
      />
      <rect x="43" y="24" width="34" height="44" rx="6" fill={STAR} {...ink} />
      {/* the compass on top */}
      <circle cx="60" cy="78" r="20" fill="#fff" {...ink} />
      <path d="M60 62L65 78L60 94L55 78Z" fill={TOMATO} {...fine} />
      <path d="M60 78L65 78L60 94L55 78Z" fill={CLOUD} {...fine} />
      <circle cx="60" cy="78" r="2.4" fill={INK} />
      <Lettering x={60} y={39} size={10}>
        N
      </Lettering>
    </>
  );
}

function Storyteller() {
  return (
    <>
      <StickerBase shape="rounded" fill="#EADFF3" />
      {/* an open book */}
      <path d="M60 52C50 44 34 42 18 46V90C34 86 50 88 60 96Z" fill="#fff" {...ink} />
      <path d="M60 52C70 44 86 42 102 46V90C86 86 70 88 60 96Z" fill="#fff" {...ink} />
      <path
        d="M26 58C34 56 44 57 52 61M26 68C34 66 44 67 52 71M68 61C76 57 86 56 94 58M68 71C76 67 86 66 94 68"
        fill="none"
        stroke="#B9A8E8"
        strokeWidth={FINE}
        strokeLinecap="round"
      />
      {/* a speech bubble rising out of the story */}
      <path
        d="M58 14H92Q98 14 98 20V32Q98 38 92 38H74L66 46L67 38H58Q52 38 52 32V20Q52 14 58 14Z"
        fill={STAR}
        {...ink}
      />
      <Lettering x={75} y={26} size={11}>
        Once…
      </Lettering>
      <Star x={30} y={30} r={8} fill={TOMATO} />
    </>
  );
}

function Designer() {
  return (
    <>
      <StickerBase shape="circle" fill="#FFF1A8" />
      {/* the palette */}
      <path
        d="M58 24C82 24 100 38 100 56C100 70 90 74 82 70C76 67 70 70 72 78C74 88 66 96 54 94C36 92 20 78 20 58C20 38 36 24 58 24Z"
        fill={CLOUD}
        {...ink}
      />
      <circle cx="42" cy="44" r="7" fill={TOMATO} {...fine} />
      <circle cx="62" cy="38" r="7" fill={STAR} {...fine} />
      <circle cx="82" cy="48" r="7" fill={LEAF} {...fine} />
      <circle cx="36" cy="66" r="7" fill={BLUE} {...fine} />
      <circle cx="54" cy="78" r="6" fill={GRAPE} {...fine} />
      {/* the brush across it */}
      <g transform="rotate(-38 82 84)">
        <rect x="78" y="54" width="9" height="40" rx="4" fill="#C98B5A" {...ink} />
        <rect x="77" y="88" width="11" height="8" rx="1.5" fill="#B8B8C4" {...ink} />
        <path d="M77 96H88C88 104 85 110 82.5 112C80 110 77 104 77 96Z" fill={TOMATO} {...ink} />
      </g>
    </>
  );
}

const ART: Record<BadgeId, () => ReactNode> = {
  "first-creation": FirstCreation,
  "first-game": FirstGame,
  "animal-friend": AnimalFriend,
  "drew-it": DrewIt,
  "big-question": BigQuestion,
  undo: Undo,
  "mo-check": MoCheck,
  voice: Voice,
  together: Together,
  "kind-words": KindWords,
  "good-night": GoodNight,
  five: Five,
  ten: Ten,
  explorer: Explorer,
  storyteller: Storyteller,
  designer: Designer,
};

/** Slight, fixed tilts so a page of stickers looks stuck on by hand (never random per render). */
const TILT: Record<BadgeId, number> = {
  "first-creation": -4,
  "first-game": 3,
  "animal-friend": -2,
  "drew-it": 4,
  "big-question": -3,
  undo: 2,
  "mo-check": -5,
  voice: 3,
  together: -2,
  "kind-words": 4,
  "good-night": -3,
  five: 5,
  ten: -2,
  explorer: 3,
  storyteller: -4,
  designer: 2,
};

export function Sticker({
  id,
  size = 96,
  silhouette = false,
  tilted = true,
  label,
  className,
}: {
  readonly id: BadgeId;
  readonly size?: number;
  /** Not found yet: the same drawing as a soft shape. */
  readonly silhouette?: boolean;
  readonly tilted?: boolean;
  /** Accessible name; the sticker is decorative when left out. */
  readonly label?: string;
  readonly className?: string;
}) {
  const Art = ART[id];
  return (
    <svg
      className={["fm-sticker", silhouette ? "fm-sticker--silhouette" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      viewBox="0 0 120 120"
      overflow="visible"
      width={size}
      height={size}
      style={tilted ? { rotate: `${TILT[id]}deg` } : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <Art />
    </svg>
  );
}
