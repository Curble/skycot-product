import type { UsageTone } from "../../plain/usage";

const SIZE = 20;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The allowance left as a ring that empties clockwise from twelve o'clock, like the Activity
 * rings. Colour comes from the tone tokens; with nothing reported it is an empty outline, so
 * "unknown" never looks like "full" or "empty". Static: it repaints only when the share changes.
 */
export function UsageRing({
  leftPercent,
  tone,
  size = SIZE,
}: {
  readonly leftPercent: number | null;
  readonly tone: UsageTone;
  readonly size?: number;
}) {
  const share = leftPercent === null ? 0 : Math.max(0, Math.min(100, leftPercent)) / 100;
  return (
    <svg
      className={`fm-usage-ring fm-usage-ring--${tone}`}
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden
      focusable="false"
    >
      <circle className="fm-usage-ring__track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} />
      {share === 0 ? null : (
        <circle
          className="fm-usage-ring__fill"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeDasharray={`${CIRCUMFERENCE * share} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
    </svg>
  );
}
