// The pieces every sticker is drawn from: SKYCOT's cloud (the brand path, nondev/brand/assets),
// Sam and Mo (the crew blobs from the brand guide, themes/CrewAvatar.tsx), and a few plain
// objects. Artwork, not chrome: fixed brand colours in every theme, like the mascot. Ink weight
// is constant in sticker units (a part drawn smaller gets a proportionally thicker stroke), so
// every sticker has the same marker line at any size.
import { useId } from "react";

export const INK = "#2B2420";
export const CLOUD = "#FFFDF8";
export const CHEEK = "#FFB4A2";
export const STAR = "#FFD166";
export const TOMATO = "#F26B4E";
export const LEAF = "#3FA66F";
export const BLUE = "#0071E3";
export const SKY = "#8ED0FF";
export const SKY_SOFT = "#BBDFFF";
export const CREAM = "#FFF6E6";
export const BELLY = "#DDEBFA";
export const GRAPE = "#9B6BD1";

/** The marker line, in sticker units (a sticker is 120 across). */
export const LINE = 3.4;
export const FINE = 2.6;

const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Avenir Next Rounded", system-ui, sans-serif';

const CLOUD_PATH =
  "M28 84A21 21 0 0 1 27.18 42.02A25 25 0 0 1 68.41 26.14A23 23 0 0 1 102.87 48.42A18 18 0 0 1 99 84Z";

export type CloudFace = "smile" | "yay" | "sleep" | "wow" | "blush";

/** SKYCOT. `w` is the body's width in sticker units; (x, y) is the body's centre. */
export function Skycot({
  x,
  y,
  w,
  face = "smile",
  tilt = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly face?: CloudFace;
  readonly tilt?: number;
}) {
  const clip = useId();
  // The body spans x 7–117 and y 14–84 in the brand drawing; its centre is (62, 49).
  const s = w / 110;
  const line = LINE / s;
  const fine = (LINE * 0.95) / s;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s}) translate(-62 -49)`}>
      <defs>
        <clipPath id={clip}>
          <path d={CLOUD_PATH} />
        </clipPath>
      </defs>
      <path d={CLOUD_PATH} fill={CLOUD} />
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="66" width="124" height="24" fill={BELLY} opacity=".85" />
        <ellipse cx="45" cy="30" rx="8" ry="4.2" fill="#fff" transform="rotate(-28 45 30)" />
      </g>
      <path d={CLOUD_PATH} fill="none" stroke={INK} strokeWidth={line} strokeLinejoin="round" />
      <CloudFaceMarks face={face} fine={fine} />
    </g>
  );
}

function CloudFaceMarks({ face, fine }: { readonly face: CloudFace; readonly fine: number }) {
  const cheeks = (
    <>
      <ellipse cx="37" cy="69" rx="6" ry="4" fill={CHEEK} opacity={face === "blush" ? 1 : 0.9} />
      <ellipse cx="87" cy="69" rx="6" ry="4" fill={CHEEK} opacity={face === "blush" ? 1 : 0.9} />
    </>
  );
  const eyes = (
    <>
      <ellipse cx="49" cy="58" rx="6" ry="9" fill={INK} />
      <ellipse cx="75" cy="58" rx="6" ry="9" fill={INK} />
      <circle cx="51.3" cy="54" r="2.2" fill="#fff" />
      <circle cx="77.3" cy="54" r="2.2" fill="#fff" />
    </>
  );
  const stroke = { fill: "none", stroke: INK, strokeWidth: fine, strokeLinecap: "round" } as const;
  switch (face) {
    case "smile":
    case "blush":
      return (
        <>
          {eyes}
          {cheeks}
          <path d="M56 68Q62 74 68 68" {...stroke} />
        </>
      );
    case "yay":
      return (
        <>
          <path d="M42 60Q49 50 56 60M68 60Q75 50 82 60" {...stroke} />
          {cheeks}
          <path d="M53 65H71Q71 80 62 80Q53 80 53 65Z" fill={INK} />
          <path d="M56.5 74.5Q62 71 67.5 74.5Q66 79 62 79Q58 79 56.5 74.5Z" fill={TOMATO} />
        </>
      );
    case "sleep":
      return (
        <>
          <path d="M42 58Q49 64 56 58M68 58Q75 64 82 58" {...stroke} />
          {cheeks}
          <path d="M58 70Q62 73 66 70" {...stroke} />
        </>
      );
    case "wow":
      return (
        <>
          {eyes}
          {cheeks}
          <ellipse cx="62" cy="72" rx="4" ry="4.8" fill={INK} />
        </>
      );
  }
}

/** Sam builds: the tomato blob in a hard hat. `size` across, centred on (x, y). */
export function Sam({
  x,
  y,
  size,
  tilt = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly tilt?: number;
}) {
  const s = size / 52;
  const line = LINE / s;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s}) translate(-32 -32)`}>
      <path
        d="M32 7c13 0 25 9 25 24 0 16-11 27-26 27C17 58 7 46 7 31 7 17 19 7 32 7z"
        fill={TOMATO}
        stroke={INK}
        strokeWidth={line}
      />
      <path
        d="M15 24c3-10 11-15 19-15 8 0 14 5 16 12"
        fill={STAR}
        stroke={INK}
        strokeWidth={line}
        strokeLinecap="round"
      />
      <rect
        x="12"
        y="22"
        width="40"
        height="6"
        rx="3"
        fill={STAR}
        stroke={INK}
        strokeWidth={line}
      />
      <circle cx="24" cy="36" r="2.8" fill={INK} />
      <circle cx="40" cy="36" r="2.8" fill={INK} />
      <path
        d="M25 45c3 3 11 3 14 0"
        fill="none"
        stroke={INK}
        strokeWidth={line}
        strokeLinecap="round"
      />
      <circle cx="18" cy="42" r="3" fill={CHEEK} opacity=".9" />
      <circle cx="46" cy="42" r="3" fill={CHEEK} opacity=".9" />
    </g>
  );
}

/** Mo checks: the leaf-green blob with round glasses. */
export function Mo({
  x,
  y,
  size,
  tilt = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly tilt?: number;
}) {
  const s = size / 54;
  const line = LINE / s;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s}) translate(-31 -32)`}>
      <path d="M20 12l-4-6M44 12l4-6" stroke={INK} strokeWidth={line} strokeLinecap="round" />
      <path
        d="M31 6c15 0 27 11 27 26 0 15-12 26-27 26S5 47 5 32 16 6 31 6z"
        fill={LEAF}
        stroke={INK}
        strokeWidth={line}
      />
      <circle cx="23" cy="33" r="7" fill="#fff" stroke={INK} strokeWidth={line} />
      <circle cx="41" cy="33" r="7" fill="#fff" stroke={INK} strokeWidth={line} />
      <path d="M30 33h4" stroke={INK} strokeWidth={line} />
      <circle cx="24" cy="34" r="2.4" fill={INK} />
      <circle cx="42" cy="34" r="2.4" fill={INK} />
      <path
        d="M25 46c3 2 11 2 14 0"
        fill="none"
        stroke={INK}
        strokeWidth={line}
        strokeLinecap="round"
      />
    </g>
  );
}

/** A five-point star centred on (x, y). */
export function starPath(x: number, y: number, outer: number, inner = outer * 0.48): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(
      `${(x + radius * Math.cos(angle)).toFixed(2)} ${(y + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join("L")}Z`;
}

export function Star({
  x,
  y,
  r,
  fill = STAR,
  line = FINE,
}: {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly fill?: string;
  readonly line?: number;
}) {
  return (
    <path
      d={starPath(x, y, r)}
      fill={fill}
      stroke={INK}
      strokeWidth={line}
      strokeLinejoin="round"
    />
  );
}

/** A four-point twinkle, no outline (the brand's dusk stars). */
export function Twinkle({
  x,
  y,
  r,
  fill = STAR,
}: {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly fill?: string;
}) {
  const k = r * 0.28;
  return (
    <path
      d={`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`}
      fill={fill}
    />
  );
}

export function Heart({
  x,
  y,
  size,
  fill = TOMATO,
  line = FINE,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fill?: string;
  readonly line?: number;
}) {
  const s = size / 20;
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s}) translate(-10 -9)`}
      d="M10 17.5C4 13 1 9.8 1 6.2 1 3.4 3.2 1.2 6 1.2c1.7 0 3.1.8 4 2.1.9-1.3 2.3-2.1 4-2.1 2.8 0 5 2.2 5 5 0 3.6-3 6.8-9 11.3z"
      fill={fill}
      stroke={INK}
      strokeWidth={line / s}
      strokeLinejoin="round"
    />
  );
}

/** Rounded, heavy lettering for numbers and short words. */
export function Lettering({
  x,
  y,
  size,
  children,
  fill = INK,
  outline,
  rotate = 0,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly children: string;
  readonly fill?: string;
  /** A marker outline around light letters. */
  readonly outline?: string;
  readonly rotate?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={FONT}
      fontWeight={900}
      fontSize={size}
      fill={fill}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      {...(outline
        ? {
            stroke: outline,
            strokeWidth: size * 0.14,
            paintOrder: "stroke",
            strokeLinejoin: "round",
          }
        : {})}
    >
      {children}
    </text>
  );
}

/** Little motion marks beside something lively (the sticker sheet's "yay" dashes). */
export function Sparks({
  marks,
}: {
  readonly marks: ReadonlyArray<readonly [number, number, number, number, string]>;
}) {
  return (
    <>
      {marks.map(([x1, y1, x2, y2, color]) => (
        <path
          key={`${x1},${y1},${x2},${y2}`}
          d={`M${x1} ${y1}L${x2} ${y2}`}
          stroke={color}
          strokeWidth={LINE}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

export type StickerShape = "circle" | "rounded" | "scallop" | "star" | "heart" | "cloud";

function scallopPath(cx: number, cy: number, r: number, bumps: number): string {
  const step = (Math.PI * 2) / bumps;
  const bump = r * Math.sin(step / 2) * 1.08;
  let d = "";
  for (let index = 0; index <= bumps; index += 1) {
    const angle = -Math.PI / 2 + index * step;
    const px = (cx + r * Math.cos(angle)).toFixed(2);
    const py = (cy + r * Math.sin(angle)).toFixed(2);
    d += index === 0 ? `M${px} ${py}` : `A${bump.toFixed(2)} ${bump.toFixed(2)} 0 0 1 ${px} ${py}`;
  }
  return `${d}Z`;
}

const SHAPES: Record<StickerShape, string> = {
  circle: "M60 12a48 48 0 1 1 0 96a48 48 0 1 1 0-96Z",
  rounded: "M34 13H86Q107 13 107 34V86Q107 107 86 107H34Q13 107 13 86V34Q13 13 34 13Z",
  scallop: scallopPath(60, 60, 44, 14),
  star: starPath(60, 63, 54, 31),
  heart:
    "M60 106C26 82 10 64 10 42 10 25 23 13 39 13c9 0 16 4 21 11 5-7 12-11 21-11 16 0 29 12 29 29 0 22-16 40-50 64Z",
  cloud: "M30 96A20 20 0 0 1 25 57A26 26 0 0 1 67 33A24 24 0 0 1 97 60A18 18 0 0 1 88 96Z",
};

/**
 * The sticker itself: a die-cut white border, a soft ink shadow, and the coloured backing with
 * the marker outline. `fill` may be a gradient (pass `gradient` for a top-to-bottom sky).
 */
export function StickerBase({
  shape,
  fill,
  gradient,
}: {
  readonly shape: StickerShape;
  readonly fill: string;
  readonly gradient?: readonly [string, string];
}) {
  const id = useId();
  const d = SHAPES[shape];
  return (
    <>
      {gradient ? (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={gradient[0]} />
            <stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      ) : null}
      <path
        d={d}
        transform="translate(2.5 3.5)"
        fill={INK}
        opacity=".18"
        stroke={INK}
        strokeWidth="11"
        strokeLinejoin="round"
        className="fm-sticker__shadow"
      />
      <path d={d} fill="#fff" stroke="#fff" strokeWidth="11" strokeLinejoin="round" />
      <path
        d={d}
        fill={gradient ? `url(#${id})` : fill}
        stroke={INK}
        strokeWidth={LINE}
        strokeLinejoin="round"
      />
    </>
  );
}
